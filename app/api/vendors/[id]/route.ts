import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Per-vendor management:
 *   PATCH  /api/vendors/[id]   Update an existing vendor
 *   DELETE /api/vendors/[id]   Delete a vendor record
 *
 * Both admin-only.
 */

// Local trim + length cap. Stricter than @/lib/auth's cleanInput, which
// doesn't size-bound. The 500-char cap is defensive against a giant
// pasted string blowing up the DB column.
const cleanCapped = (s: unknown) =>
  typeof s === "string" ? s.trim().slice(0, 500) : "";

const sanitizeEmail = (s: unknown) => {
  const v = cleanCapped(s);
  if (!v) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "__INVALID__";
  return v;
};

function parseId(idStr: string): number | null {
  const n = Number(idStr);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "Invalid vendor id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = cleanCapped(body.name);
    if (!name) return NextResponse.json({ error: "Vendor name cannot be empty" }, { status: 400 });
    updates.name = name;
  }
  if (body.rma_email !== undefined) {
    const email = sanitizeEmail(body.rma_email);
    if (email === "__INVALID__") {
      return NextResponse.json({ error: "RMA email looks malformed" }, { status: 400 });
    }
    updates.rma_email = email || null;
  }
  if (body.contact_name !== undefined) {
    updates.contact_name = cleanCapped(body.contact_name) || null;
  }
  if (body.notes !== undefined) {
    updates.notes = cleanCapped(body.notes) || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("vendors")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Another vendor already has that name" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  }
  return NextResponse.json({ vendor: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "Invalid vendor id" }, { status: 400 });

  const { error } = await supabase.from("vendors").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
