import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { cleanInput, checkRateLimit } from "@/lib/auth";
import {
  SNIFF_BYTES, sniffMagicBytes, safeContentType,
  PUBLIC_UPLOAD_TYPES, PUBLIC_UPLOAD_LABEL,
} from "@/lib/fileValidation";

/**
 * Origins allowed to call this endpoint from a browser.
 *
 * Was "*", which let any site post to it. A PLAIN form POST sends no Origin
 * header and is unaffected by CORS either way, so requests without an
 * Origin are still served -- this only constrains scripted cross-site calls.
 *
 * Override with QUOTE_ALLOWED_ORIGINS (comma-separated) if the storefront
 * ever moves. The default covers both www and apex.
 */
const ALLOWED_ORIGINS = (process.env.QUOTE_ALLOWED_ORIGINS
  ?? "https://jkcabinets2you.com,https://www.jkcabinets2you.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

function corsFor(req: NextRequest): Record<string, string> {
  const base = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const origin = (req.headers.get("origin") ?? "").toLowerCase();
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin };
  }
  // No Origin (plain form post, server-to-server) or a disallowed one:
  // send no ACAO header. The request still runs; a browser XHR from an
  // unlisted origin simply cannot read the response.
  return base;
}

const STORAGE_BUCKET = "order-attachments";
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file
const MAX_FILES = 10;                    // CWE-770: cap attachments per submission
const MAX_TOTAL_UPLOAD_BYTES = 60 * 1024 * 1024; // 60 MB total
const MAX_BODY_LEN = 100_000;            // text payload cap for JSON/text submissions
const MAX_FIELD_LEN = 4_000;             // per-field cap on form values

// Allow-list of hostnames we trust to embed as a legacy attachment URL. Any
// other host is rejected. Prevents the public form from being used to seed
// arbitrary external links into the order_attachments table.
const LEGACY_URL_HOST_ALLOWLIST = (process.env.QUOTE_LEGACY_URL_HOSTS ?? "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsFor(req) });
}

function extractField(text: string, ...fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    const regexNewline = new RegExp(`${fieldName}\\s*:\\s*([^\\n\\r]+)`, "i");
    const matchNewline = text.match(regexNewline);
    if (matchNewline) {
      const value = matchNewline[1].trim();
      const nextField = value.match(/^(.*?)\s+(?:Phone|Email|Address|Name|More Details|Cabinet|Door|Color)\s*:/i);
      return (nextField ? nextField[1].trim() : value).slice(0, MAX_FIELD_LEN);
    }
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeFileName(name: string): string {
  // Restrict to alphanum, dot, underscore, hyphen — same as admin uploader.
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Cap length & strip leading dots so we can't write hidden files / traverse.
  return base.replace(/^\.+/, "_").slice(0, 200) || "file";
}

function isAllowedLegacyUrl(url: string): boolean {
  if (LEGACY_URL_HOST_ALLOWLIST.length === 0) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  return LEGACY_URL_HOST_ALLOWLIST.includes(parsed.hostname.toLowerCase());
}

export async function POST(req: NextRequest) {
  // Per-request, because the allowed origin is echoed back.
  const CORS = corsFor(req);

  // ── Rate limit by IP (this is a public, unauthenticated endpoint) ─────────
  const allowed = await checkRateLimit(req, 10, 60_000, "quote-form");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...CORS, "Retry-After": "60" } }
    );
  }

  // ── Pre-emptive size check on the raw request ──────────────────────────────
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_TOTAL_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413, headers: CORS }
    );
  }

  let body: Record<string, string> = {};
  const incomingFiles: File[] = [];

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await req.text();
      if (raw.length > MAX_BODY_LEN) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: CORS });
      }
      const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
      body = JSON.parse(cleaned);
    } else if (contentType.includes("form")) {
      const fd = await req.formData();
      let totalBytes = 0;
      fd.forEach((v, k) => {
        if (v instanceof File) {
          if (v.size > 0) {
            incomingFiles.push(v);
            totalBytes += v.size;
          }
        } else {
          // Per-field length cap to prevent megabyte-strings DoS
          body[k] = String(v).slice(0, MAX_FIELD_LEN);
        }
      });
      if (incomingFiles.length > MAX_FILES) {
        return NextResponse.json(
          { error: `Too many files (max ${MAX_FILES})` },
          { status: 413, headers: CORS }
        );
      }
      if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "Total upload size exceeds limit" },
          { status: 413, headers: CORS }
        );
      }
    } else {
      const raw = await req.text();
      if (raw.length > MAX_BODY_LEN) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: CORS });
      }
      try {
        const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
        body = JSON.parse(cleaned);
      } catch {
        body = { notes: raw };
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not parse body" }, { status: 400, headers: CORS });
  }

 // ── Honeypot check ────────────────────────────────────────────────────────
  // The public form has a hidden "website" field. Real humans never see it
  // (CSS hides it off-screen). Bots scrape the HTML and dutifully fill it in.
  // If it has any value, drop the submission silently — fake success so the
  // bot thinks it worked and doesn't retry. Don't write to the DB.
  if (body.website && body.website.trim() !== "") {
    return NextResponse.json(
      { ok: true, order_id: `QUO-${Date.now()}` },
      { status: 201, headers: CORS }
    );
  }

  // A human cannot fill this form in under two seconds. Same treatment
  // as the honeypot: fake success, no database write, so the bot does
  // not retry with a slower script.
  //
  // FRICTION, NOT A CONTROL. elapsed_ms is client-supplied and trivially
  // forged -- it raises the cost of a naive bot and nothing more. It is
  // a no-op until the form starts sending the field, which is
  // deliberate: absent means skip, so this can land before the
  // storefront changes.
  const elapsedRaw = body.elapsed_ms;
  if (elapsedRaw !== undefined && elapsedRaw !== null) {
    const elapsed = Number(elapsedRaw);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2000) {
      return NextResponse.json(
        { ok: true, order_id: `QUO-${Date.now()}` },
        { status: 201, headers: CORS },
      );
    }
  }

  // ── Optional shared-secret check (constant-time) ──────────────────────────
  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret) {
    const provided = body.secret ?? "";
    // constant-time compare to avoid timing side channel
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    let equal = false;
    if (a.length === b.length) {
      try { equal = crypto.timingSafeEqual(a, b); } catch { equal = false; }
    }
    if (!equal) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }
  }

  // Belt-and-braces per-file checks, plus type validation.
  //
  // The type is taken from the file's OWN BYTES, never from file.type --
  // that is the browser's claim, and this endpoint is anonymous. An SVG or
  // HTML file with an embedded script, uploaded with a chosen MIME, would
  // otherwise execute when a staff member opened it via a signed URL.
  const sniffedTypes = new Map<File, string>();
  for (const file of incomingFiles) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File "${file.name}" is too large (max 20 MB)` },
        { status: 413, headers: CORS },
      );
    }
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const mime = sniffMagicBytes(head);
    if (!mime || !PUBLIC_UPLOAD_TYPES.has(mime)) {
      return NextResponse.json(
        {
          error: `"${cleanInput(file.name)}" is not an accepted file type.`
            + ` Please attach ${PUBLIC_UPLOAD_LABEL}.`,
        },
        { status: 415, headers: CORS },
      );
    }
    sniffedTypes.set(file, mime);
  }

  const rawBody = body.notes || body.html || body.text || "";
  const fullText = rawBody.includes("<") ? stripHtml(rawBody) : rawBody;

  let plainText = fullText.slice(0, MAX_BODY_LEN);
  const moreInfoMatch = fullText.match(/More information\s*([\s\S]+?)(?:If you have any questions|Click here to unsubscribe|$)/i);
  if (moreInfoMatch) {
    plainText = moreInfoMatch[1].trim().slice(0, MAX_BODY_LEN);
  }

  const extractedName    = extractField(plainText, "Name");
  const extractedEmail   = extractField(plainText, "Email");
  const extractedPhone   = extractField(plainText, "Phone");
  const extractedAddress = extractField(plainText, "Address");
  const extractedBudget  = body.budget || extractField(plainText, "Budget");
  const extractedCabinet = extractField(plainText, "Cabinet Line", "Cabinet", "Select Your Cabinet Line");
  const extractedDoor    = extractField(plainText, "Door Style", "Choose Your Door Style", "Door");
  const extractedColor   = extractField(plainText, "Color", "Select Your Color", "Colour");
  const extractedDetails = extractField(plainText, "More Details", "Details", "Additional Details", "Notes");

  // Trimmed and length-capped. NOT escaped: cleanInput only trims. Anything
  // templating these into HTML (the PDF export) must call escapeHtml at the
  // point of output -- see the note on cleanInput in lib/auth.ts.
  const name    = cleanInput((body.name    || extractedName    || "Quote Request").slice(0, MAX_FIELD_LEN));
  const email   = cleanInput((body.email   || extractedEmail   || "").slice(0, MAX_FIELD_LEN));
  const phone   = cleanInput((body.phone   || extractedPhone   || "").slice(0, MAX_FIELD_LEN));
  const address = cleanInput((body.address || extractedAddress || "").slice(0, MAX_FIELD_LEN));
  const city    = cleanInput((body.city    || "").slice(0, MAX_FIELD_LEN));
  const state   = cleanInput((body.state   || "").slice(0, MAX_FIELD_LEN));
  const zip     = cleanInput((body.zip     || "").slice(0, MAX_FIELD_LEN));
  const doorStyle   = cleanInput((body.door_style   || extractedDoor    || "").slice(0, MAX_FIELD_LEN));
  const color       = cleanInput((body.color        || extractedColor   || "").slice(0, MAX_FIELD_LEN));
  const cabinetLine = cleanInput((body.cabinet_line || extractedCabinet || "").slice(0, MAX_FIELD_LEN));

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

  // Legacy attachment URL — only accept if it matches the allow-list. This
  // prevents the public endpoint from being used to store attacker-controlled
  // URLs that later get presented to authenticated staff.
  const legacyAttachmentUrlCandidate = body.attachment_url || (() => {
    const urlMatch = plainText.match(/https?:\/\/[^\s\n]+\.(?:pdf|png|jpg|jpeg|heic)/i);
    return urlMatch ? urlMatch[0] : "";
  })();
  const legacyAttachmentUrl =
    legacyAttachmentUrlCandidate && isAllowedLegacyUrl(legacyAttachmentUrlCandidate)
      ? legacyAttachmentUrlCandidate
      : "";

  const notesParts: string[] = [];
  notesParts.push(`📋 QUOTE REQUEST — ${today}`);
  notesParts.push(`Customer: ${name}`);
  if (phone)   notesParts.push(`Phone: ${phone}`);
  if (email)   notesParts.push(`Email: ${email}`);
  if (address) notesParts.push(`Address: ${address}`);
  if (city)    notesParts.push(`City: ${city}`);
  if (state)   notesParts.push(`State: ${state}`);
  if (zip)     notesParts.push(`Zip: ${zip}`);
  if (extractedBudget) notesParts.push(`Budget: ${cleanInput(extractedBudget)}`);
  if (cabinetLine) notesParts.push(`Cabinet Line: ${cabinetLine}`);
  if (doorStyle)   notesParts.push(`Door Style: ${doorStyle}`);
  if (color)       notesParts.push(`Color: ${color}`);
  const rawNotes = body.notes || "";
  const customerNotesFinal = cleanInput((rawNotes || extractedDetails || "").slice(0, MAX_BODY_LEN));
  if (customerNotesFinal) notesParts.push(`Notes: ${customerNotesFinal}`);
  if (incomingFiles.length > 0) {
    notesParts.push(`📎 ${incomingFiles.length} file${incomingFiles.length === 1 ? "" : "s"} attached`);
  } else if (legacyAttachmentUrl) {
    notesParts.push(`📎 Attachment: ${legacyAttachmentUrl}`);
  }
  const notes = notesParts.join("\n");

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    type: "order",
    name,
    source: "Manual",
    detail: "Custom quote request",
    stage: "New",
    member: "",
    date: today,
    sku: "—",
    notes,
    archived: false,
    door_style: doorStyle,
    color,
    sku_items: [],
    vendor: "",
    ship_to: address,
    customer_phone: phone,
    customer_email: email,
    delivery_method: "",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  await supabase.from("order_activity").insert({
    order_id: orderId,
    text: "Quote request received from website form",
    time: today,
  });

  // === Save uploaded files ===
  const uploadedFiles: { name: string; path: string }[] = [];
  for (const file of incomingFiles) {
    const safeName = sanitizeFileName(file.name);
    const filePath = `${orderId}/${Date.now()}-${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    // The sniffed type, never file.type. Validated above, so it is always
    // present here.
    const storedType = sniffedTypes.get(file) ?? "application/octet-stream";

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: storedType,
        upsert: false,
      });

    if (uploadError) {
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text: `⚠️ Failed to save attachment "${cleanInput(file.name)}": ${cleanInput(uploadError.message)}`,
        time: today,
      });
      continue;
    }

    const { error: dbError } = await supabase.from("order_attachments").insert({
      order_id: orderId,
      file_name: cleanInput(file.name),
      file_path: filePath,
      file_size: file.size,
      file_type: storedType,
      uploaded_by: "Customer (form submission)",
    });

    if (dbError) {
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text: `⚠️ File "${cleanInput(file.name)}" uploaded but DB row failed: ${cleanInput(dbError.message)}`,
        time: today,
      });
      continue;
    }

    uploadedFiles.push({ name: file.name, path: filePath });
  }

  // === Legacy URL-only path (allow-listed hosts only) ===
  if (legacyAttachmentUrl && incomingFiles.length === 0) {
    const fileName = legacyAttachmentUrl.split("/").pop()?.split("?")[0] || "Customer Attachment";
    await supabase.from("order_attachments").insert({
      order_id: orderId,
      file_name: cleanInput(fileName),
      file_path: legacyAttachmentUrl,
      file_size: 0,
      file_type: legacyAttachmentUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg",
      uploaded_by: "Customer (form submission, legacy URL)",
    });
  }

  return NextResponse.json(
    {
      ok: true,
      order_id: orderId,
      attachments_saved: uploadedFiles.length,
    },
    { status: 201, headers: CORS },
  );
}
