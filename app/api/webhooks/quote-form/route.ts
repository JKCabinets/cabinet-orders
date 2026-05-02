import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Parse field value from email body text
 * Handles formats like "Name: John Smith" or "Name:John Smith"
 */
function extractField(text: string, fieldName: string): string {
  const regex = new RegExp(`${fieldName}\\s*:\\s*([^\\n]+)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Strip HTML tags from email body
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

export async function POST(req: NextRequest) {
  let body: Record<string, string> = {};

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await req.text();
      const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
      body = JSON.parse(cleaned);
    } else if (contentType.includes("form")) {
      const fd = await req.formData();
      fd.forEach((v, k) => { body[k] = String(v); });
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

  // Verify secret
  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  // Get the email body — try plain text first, then strip HTML
  const rawNotes = body.notes || body.html || body.text || "";
  const plainText = rawNotes.includes("<") ? stripHtml(rawNotes) : rawNotes;

  // If name/email/phone weren't passed as separate fields, extract from email body
  const name    = body.name    || extractField(plainText, "Name")    || "Unknown Customer";
  const email   = body.email   || extractField(plainText, "Email")   || "";
  const phone   = body.phone   || extractField(plainText, "Phone")   || "";
  const address = body.address || extractField(plainText, "Address") || "";

  // Also try to extract form-specific fields from the email body
  const cabinetLine = body.cabinet_line || extractField(plainText, "Cabinet Line") || extractField(plainText, "Cabinet") || "";
  const doorStyle   = body.door_style   || extractField(plainText, "Door Style")   || extractField(plainText, "Door")    || "";
  const color       = body.color        || extractField(plainText, "Color")        || extractField(plainText, "Colour")  || "";
  const moreDetails = body.more_details || extractField(plainText, "More Details") || extractField(plainText, "Details") || "";

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

  // Build clean notes
  const notesParts: string[] = [];
  if (cabinetLine) notesParts.push(`Cabinet Line: ${cabinetLine}`);
  if (doorStyle)   notesParts.push(`Door Style: ${doorStyle}`);
  if (color)       notesParts.push(`Color: ${color}`);
  if (moreDetails) notesParts.push(`Customer Notes: ${moreDetails}`);
  if (body.attachment_url) notesParts.push(`Measuring Guide: ${body.attachment_url}`);
  // Always include full email body as reference
  if (plainText)   notesParts.push(`\n--- Full Form Submission ---\n${plainText}`);
  const notes = notesParts.join("\n\n");

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

  return NextResponse.json({ ok: true, order_id: orderId }, { status: 201, headers: CORS });
}
