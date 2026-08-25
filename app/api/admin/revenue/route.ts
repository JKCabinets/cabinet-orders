import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Running revenue — month to date and year to date.
 *
 * ⚠ TWO SUMS, AND THAT IS NOT A WORKAROUND.
 *
 *     sum(projects.total_price)   Shopify checkouts
 *   + sum(orders.total_price)     standalone custom jobs
 *
 * A Shopify checkout is one PROJECT with one `orders` row per product category,
 * so a total stored per group would double-count any order with more than one.
 * Custom jobs have no project -- they are contract work carrying no Shopify
 * products at all -- so their total lives on the order row.
 *
 * No overlap is possible. `orders_total_price_standalone_only` forbids a
 * project-linked row from carrying a total, so a row is in exactly one of these
 * two sets. That constraint is what makes this safe rather than conventional:
 * Postgres enforces it, not a comment somebody has to read.
 *
 * ⚠ DATED BY WHEN THE ORDER WAS PLACED, not when it was delivered or paid.
 * "What came in this month" is the question a running total answers, and a
 * placed date never moves. Delivery-dated revenue would let a figure change
 * retroactively as old orders complete, which is a different question and a
 * worse one to put on a dashboard without saying so.
 *
 * Refunded projects are EXCLUDED. A refund is not revenue, and financial_status
 * already reaches the OMS on every orders/updated.
 */

const REFUNDED = ["refunded", "partially_refunded", "voided"];

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
function yearStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
}

async function sumProjects(since: string): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase
    .from("projects")
    .select("total_price, payment_status")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter(
    (r) => !REFUNDED.includes(String(r.payment_status ?? "").toLowerCase()));
  return {
    total: rows.reduce((n, r) => n + (Number(r.total_price) || 0), 0),
    count: rows.length,
  };
}

async function sumCustom(since: string): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase
    .from("orders")
    .select("total_price")
    .is("project_id", null)
    .not("total_price", "is", null)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    total: rows.reduce((n, r) => n + (Number(r.total_price) || 0), 0),
    count: rows.length,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "admin:revenue");
  if (limited) return limited;

  const now = new Date();

  try {
    const [pm, py, cm, cy] = await Promise.all([
      sumProjects(monthStart(now)),
      sumProjects(yearStart(now)),
      sumCustom(monthStart(now)),
      sumCustom(yearStart(now)),
    ]);

    return NextResponse.json({
      month: {
        shopify: pm.total,
        custom: cm.total,
        total: pm.total + cm.total,
        orders: pm.count + cm.count,
      },
      year: {
        shopify: py.total,
        custom: cy.total,
        total: py.total + cy.total,
        orders: py.count + cy.count,
      },
      // Nullable money means UNKNOWN, not zero. A project ingested before the
      // money columns existed contributes 0 to the sum while being a real
      // order, so the count of those is reported rather than hidden -- a total
      // that silently omits orders is worse than one that says how many.
      unpriced: {
        month: await unpricedProjects(monthStart(now)),
        year: await unpricedProjects(yearStart(now)),
      },
      dated_by: "order placed",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function unpricedProjects(since: string): Promise<number> {
  const { count, error } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .is("total_price", null)
    .gte("created_at", since);
  if (error) return 0;
  return count ?? 0;
}
