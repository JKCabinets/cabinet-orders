import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Vendor management for the RMA email feature.
 *
 *   GET  /api/vendors         List all vendors (any team member; used by
 *                             the DamageReportPanel's "Draft email" button)
 *   POST /api/vendors         Create a new vendor (admin only)
 *
 * Per-row update / delete lives at /api/vendors/[id].
 */

const sanitize = (s: unknown) =>
  typeof s === "string" ? s.trim().slice(0, 500) : "";

const sanitizeEmail = (s: unknown) => {
  const v = sanitize(s);
  if (!v) return "";
  // Loose validation only — Shopify's vendor email field doesn't
  // enforce a strict format and we don't want to reject "ar+rma@..."
  // or other valid edge cases. Just require something resembling
  // local@domain.tld.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "__INVALID__";
  return v;
};

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const name = sanitize(body.name);
  const rmaEmail = sanitizeEmail(body.rma_email);
  const contactName = sanitize(body.contact_name);
  const notes = sanitize(body.notes);

  if (!name) {
    return NextResponse.json({ error: "Vendor name is required" }, { status: 400 });
  }
  if (rmaEmail === "__INVALID__") {
    return NextResponse.json({ error: "RMA email looks malformed" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vendors")
    .insert({
      name,
      rma_email: rmaEmail || null,
      contact_name: contactName || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    // Unique violation on name → friendly 409
    if (error.code === "23505") {
      return NextResponse.json({ error: `Vendor "${name}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vendor: data });
}
