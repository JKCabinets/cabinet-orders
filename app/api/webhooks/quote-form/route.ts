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

  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
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
  const extractedCabinet = extractField(plainText, "Cabinet Line", "Cabinet", "Select Your Cabinet Line");
  const extractedDoor    = extractField(plainText, "Door Style", "Choose Your Door Style", "Door");
  const extractedColor   = extractField(plainText, "Color", "Select Your Color", "Colour");
  const extractedDetails = extractField(plainText, "More Details", "Details", "Additional Details", "Notes");

  // Use extracted values, fall back to directly passed fields
  const name    = extractedName    || body.name    || "Quote Request";
  const email   = extractedEmail   || body.email   || "";
  const phone   = extractedPhone   || body.phone   || "";
  const address = extractedAddress || body.address || "";
  const doorStyle  = extractedDoor    || body.door_style   || "";
  const color      = extractedColor   || body.color        || "";
  const cabinetLine = extractedCabinet || body.cabinet_line || "";

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

  // Build clean structured notes
  const notesParts: string[] = [];
  if (cabinetLine) notesParts.push(`Cabinet Line: ${cabinetLine}`);
  if (doorStyle)   notesParts.push(`Door Style: ${doorStyle}`);
  if (color)       notesParts.push(`Color: ${color}`);
  if (extractedDetails) notesParts.push(`Customer Notes: ${extractedDetails}`);
  if (body.attachment_url) notesParts.push(`Measuring Guide: ${body.attachment_url}`);
  notesParts.push(`\nForm submission received — ${today}`);
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

  return NextResponse.json({ ok: true, order_id: orderId }, { status: 201, headers: CORS });
}
