import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Projects — one row per purchase.
 *
 * A Shopify checkout is one PROJECT with one `orders` row per product category
 * (cabinets, hardware, samples). The project owns what belongs to the whole
 * purchase: the customer, the address, and the four money columns. A checkout
 * has ONE total, so summing a column on `orders` would double-count any order
 * with more than one group.
 *
 * WHY A SEPARATE ROUTE RATHER THAN AN EMBEDDED JOIN.
 *
 * `/api/orders` could select `*, project:projects(*)` and hand the client a
 * copy of the project on every group. That duplicates the project N times per
 * checkout, and -- the reason that matters -- it makes the Realtime merge
 * awkward: a `projects` UPDATE would have to find every group carrying a copy
 * and patch each one. With a separate array there is one row to update.
 *
 * Custom jobs and warranty claims have no project. They are standalone rows
 * with a NULL project_id, so they simply do not appear here.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "projects:get");
  if (limited) return limited;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
