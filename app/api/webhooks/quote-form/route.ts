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

export async function POST(req: NextRequest) {
  let body: Record<string, string> = {};

  // Try JSON first, fall back to text
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await req.text();
      // Strip control characters that break JSON
      const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, " ");
      body = JSON.parse(cleaned);
    } else if (contentType.includes("form")) {
      const fd = await req.formData();
      fd.forEach((v, k) => { body[k] = String(v); });
    } else {
      const raw = await req.text();
      try {
        const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, " ");
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

  const name = body.name || "Unknown Customer";
  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

  // Build notes from all available fields
  const notesParts: string[] = [];
  if (body.cabinet_line) notesParts.push(`Cabinet Line: ${body.cabinet_line}`);
  if (body.door_style)   notesParts.push(`Door Style: ${body.door_style}`);
  if (body.color)        notesParts.push(`Color: ${body.color}`);
  if (body.notes)        notesParts.push(`Details:\n${body.notes}`);
  if (body.attachment_url) notesParts.push(`Measuring Guide: ${body.attachment_url}`);
  const notes = notesParts.join("\n\n") || body.notes || "";

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    type: "order",
    name,
    source: "Manual",
    detail: `Custom quote request`,
    stage: "New",
    member: "GB",
    date: today,
    sku: "—",
    notes,
    archived: false,
    door_style: body.door_style ?? "",
    color: body.color ?? "",
    sku_items: [],
    vendor: "",
    ship_to: body.address ?? "",
    customer_phone: body.phone ?? "",
    customer_email: body.email ?? "",
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


/**
 * POST /api/webhooks/quote-form
 *
 * Called by Zapier when a customer submits the quote request form on Shopify.
 * Zapier maps the Powerful Form Builder fields to this JSON body and POSTs here.
 *
 * Expected body (all fields optional except name):
 * {
 *   secret:        string   // WEBHOOK_SECRET env var — rejects unauthorized calls
 *   name:          string   // Customer full name
 *   email:         string
 *   phone:         string
 *   address:       string   // Ship-to address
 *   cabinet_line:  string   // "Select Cabinetry, HCI Cabinetry" etc.
 *   door_style:    string   // "Shaker, Vista" etc.
 *   color:         string   // "Painted Linen, Oat" etc.
 *   notes:         string   // "More Details" field from form
 *   attachment_url: string  // URL of uploaded measuring guide PDF (Zapier can pass this)
 * }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  // Verify secret so random internet traffic can't create orders
  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 422, headers: CORS });
  }

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  const orderId = `QUO-${Date.now()}`;

  // Build a readable notes string from the form fields
  const notesParts: string[] = [];
  if (body.cabinet_line) notesParts.push(`Cabinet Line: ${body.cabinet_line}`);
  if (body.door_style)   notesParts.push(`Door Style: ${body.door_style}`);
  if (body.color)        notesParts.push(`Color: ${body.color}`);
  if (body.notes)        notesParts.push(`Customer Notes: ${body.notes}`);
  if (body.attachment_url) notesParts.push(`Measuring Guide: ${body.attachment_url}`);
  const notes = notesParts.join("\n");

  // Insert the order
  const { error } = await supabase.from("orders").insert({
    id: orderId,
    type: "order",
    name: body.name,
    source: "Manual",
    detail: `Custom quote request — ${[body.cabinet_line, body.door_style].filter(Boolean).join(", ") || "see notes"}`,
    stage: "New",
    member: "GB",
    date: today,
    sku: "—",
    notes,
    archived: false,
    door_style: body.door_style ?? "",
    color: body.color ?? "",
    sku_items: [],
    vendor: "",
    ship_to: body.address ?? "",
    customer_phone: body.phone ?? "",
    customer_email: body.email ?? "",
    delivery_method: "",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  // Log activity
  await supabase.from("order_activity").insert({
    order_id: orderId,
    text: "Quote request received from website form",
    time: today,
  });

  // If Zapier passed an attachment URL, save it as an attachment record
  if (body.attachment_url) {
    await supabase.from("order_attachments").insert({
      order_id: orderId,
      file_name: "Measuring & Planning Guide.pdf",
      file_path: body.attachment_url,
      file_size: 0,
      file_type: "application/pdf",
      uploaded_by: "Customer (form submission)",
    }).then(() => {});  // fire and forget, don't fail if this errors
  }

  return NextResponse.json(
    { ok: true, order_id: orderId },
    { status: 201, headers: CORS }
  );
}
