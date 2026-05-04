import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const STORAGE_BUCKET = "order-attachments";
const MAX_FILE_BYTES = 20 * 1024 * 1024; // match existing admin upload limit (20 MB)

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function extractField(text: string, ...fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    // Try newline-separated format first: "Name: John\n"
    const regexNewline = new RegExp(`${fieldName}\\s*:\\s*([^\\n\\r]+)`, "i");
    const matchNewline = text.match(regexNewline);
    if (matchNewline) {
      // Make sure we only get the value up to the next field name
      const value = matchNewline[1].trim();
      // Stop at next known field label
      const nextField = value.match(/^(.*?)\s+(?:Phone|Email|Address|Name|More Details|Cabinet|Door|Color)\s*:/i);
      return nextField ? nextField[1].trim() : value;
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
  // Match the convention used by app/api/orders/attachments/route.ts so
  // filenames stored by the admin upload endpoint and by the public
  // webhook follow the same rules.
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: NextRequest) {
  let body: Record<string, string> = {};
  // Files attached on multipart submissions. Empty for JSON submissions.
  const incomingFiles: File[] = [];

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await req.text();
      const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
      body = JSON.parse(cleaned);
    } else if (contentType.includes("form")) {
      const fd = await req.formData();
      fd.forEach((v, k) => {
        if (v instanceof File) {
          // Skip empty File entries (browsers sometimes include zero-byte
          // file inputs even when nothing was selected)
          if (v.size > 0) incomingFiles.push(v);
        } else {
          body[k] = String(v);
        }
      });
    } else {
      const raw = await req.text();
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

  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  // Reject anything that exceeds the per-file size limit before doing further work.
  for (const file of incomingFiles) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File "${file.name}" is too large (max 20 MB)` },
        { status: 413, headers: CORS },
      );
    }
  }

  // Get email body — strip HTML if needed
  const rawBody = body.notes || body.html || body.text || "";
  const fullText = rawBody.includes("<") ? stripHtml(rawBody) : rawBody;

  // Strip email boilerplate — only keep the "More information" section
  let plainText = fullText;
  const moreInfoMatch = fullText.match(/More information\s*([\s\S]+?)(?:If you have any questions|Click here to unsubscribe|$)/i);
  if (moreInfoMatch) {
    plainText = moreInfoMatch[1].trim();
  }

  // Extract fields from email body text
  // Powerful Form Builder email format: "Name: John\nPhone: 480...\nEmail: ...\nAddress: ..."
  const extractedName    = extractField(plainText, "Name");
  const extractedEmail   = extractField(plainText, "Email");
  const extractedPhone   = extractField(plainText, "Phone");
  const extractedAddress = extractField(plainText, "Address");
  const extractedBudget  = body.budget || extractField(plainText, "Budget");
  const extractedCabinet = extractField(plainText, "Cabinet Line", "Cabinet", "Select Your Cabinet Line");
  const extractedDoor    = extractField(plainText, "Door Style", "Choose Your Door Style", "Door");
  const extractedColor   = extractField(plainText, "Color", "Select Your Color", "Colour");
  const extractedDetails = extractField(plainText, "More Details", "Details", "Additional Details", "Notes");

  // Use directly passed fields first (custom form), fall back to email parsing
  const name    = body.name    || extractedName    || "Quote Request";
  const email   = body.email   || extractedEmail   || "";
  const phone   = body.phone   || extractedPhone   || "";
  const address = body.address || extractedAddress || "";
  const city    = body.city    || "";
  const state   = body.state   || "";
  const zip     = body.zip     || "";
  const doorStyle  = body.door_style   || extractedDoor    || "";
  const color      = body.color        || extractedColor   || "";
  const cabinetLine = body.cabinet_line || extractedCabinet || "";

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

  // Build clean structured notes
  // Extract attachment URL from email body if not passed directly. (Legacy
  // PowerfulForm path — they email a link to the uploaded file.)
  const legacyAttachmentUrl = body.attachment_url || (() => {
    const urlMatch = plainText.match(/https?:\/\/[^\s\n]+\.(?:pdf|png|jpg|jpeg|heic)/i);
    return urlMatch ? urlMatch[0] : "";
  })();

  const notesParts: string[] = [];
  notesParts.push(`📋 QUOTE REQUEST — ${today}`);
  notesParts.push(`Customer: ${name}`);
  if (phone)   notesParts.push(`Phone: ${phone}`);
  if (email)   notesParts.push(`Email: ${email}`);
  if (address) notesParts.push(`Address: ${address}`);
  if (city)    notesParts.push(`City: ${city}`);
  if (state)   notesParts.push(`State: ${state}`);
  if (zip)     notesParts.push(`Zip: ${zip}`);
  if (extractedBudget) notesParts.push(`Budget: ${extractedBudget}`);
  if (cabinetLine) notesParts.push(`Cabinet Line: ${cabinetLine}`);
  if (doorStyle)   notesParts.push(`Door Style: ${doorStyle}`);
  if (color)       notesParts.push(`Color: ${color}`);
  const rawNotes = body.notes || "";
  const customerNotesFinal = rawNotes || extractedDetails || "";
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
    member: "GB",
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

  // === Save uploaded files (multipart submissions) ===
  // For each File entry from the form, upload binary to the same Supabase
  // bucket used by the admin attachments route, then insert a row into
  // order_attachments with the relative storage path. Storing the relative
  // path (not a URL) is what the admin GET-attachment route expects so it
  // can call createSignedUrl successfully.
  const uploadedFiles: { name: string; path: string }[] = [];
  for (const file of incomingFiles) {
    const safeName = sanitizeFileName(file.name);
    const filePath = `${orderId}/${Date.now()}-${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      // Don't 500 the whole request — the order was already saved. Log a
      // breadcrumb in order_activity so the team knows the file didn't make
      // it and they can follow up with the customer.
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text: `⚠️ Failed to save attachment "${file.name}": ${uploadError.message}`,
        time: today,
      });
      continue;
    }

    const { error: dbError } = await supabase.from("order_attachments").insert({
      order_id: orderId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      file_type: file.type || "application/octet-stream",
      uploaded_by: "Customer (form submission)",
    });

    if (dbError) {
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text: `⚠️ File "${file.name}" uploaded but DB row failed: ${dbError.message}`,
        time: today,
      });
      continue;
    }

    uploadedFiles.push({ name: file.name, path: filePath });
  }

  // === Legacy: save attachment URL if present (no file upload, JSON path) ===
  // Kept for backwards compatibility with any inbound integration that still
  // passes an attachment_url. Storing the URL in file_path means it won't be
  // downloadable through the admin's signed-URL flow, but it'll still appear
  // in the order_attachments listing as a reference.
  if (legacyAttachmentUrl && incomingFiles.length === 0) {
    const fileName = legacyAttachmentUrl.split("/").pop()?.split("?")[0] || "Customer Attachment";
    await supabase.from("order_attachments").insert({
      order_id: orderId,
      file_name: fileName,
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
