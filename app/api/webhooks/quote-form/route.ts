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

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const raw = await req.text();
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

  const secret = process.env.QUOTE_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const name = body.name || "Unknown Customer";
  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const orderId = `QUO-${Date.now()}`;

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
    detail: "Custom quote request",
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
