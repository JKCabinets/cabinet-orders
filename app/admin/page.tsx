"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Shield } from "lucide-react";
import { AuditLog } from "@/components/AuditLog";
import { AppShell, PageHeader } from "@/components/AppShell";

/**
 * /admin - admin landing page.
 *
 * Team member management moved to /admin/team on 2026-07-29. What remains
 * is the tool index: all admin buttons at the top, the sales-metrics panel
 * below them, then the audit log.
 *
 * The metrics panel is deliberately NOT built yet. It reports on standard
 * AND custom orders, and custom orders arrive with Alternate Orders; writing
 * the query against today's schema would guarantee rewriting it. See the
 * marked comment below for where it goes.
 *
 * SECURITY: the isAdmin check below hides UI. It does NOT protect data.
 * The real gate is route-level - requireAdmin() on the /api/admin/* routes
 * and on the mutating /api/team routes.
 */

/**
 * Running revenue — month and year to date.
 *
 * ⚠ TWO SUMS, one from `projects` (Shopify checkouts) and one from `orders`
 * (standalone custom jobs). No overlap is possible:
 * orders_total_price_standalone_only forbids a project-linked row from
 * carrying a total, so a row is in exactly one set.
 *
 * Dated by when the order was PLACED. A placed date never moves; a
 * delivery-dated figure would change retroactively as old orders complete,
 * which is a different question and a worse one to leave unlabelled.
 */
function RevenuePanel() {
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/revenue");
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Could not load revenue");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)]">Revenue</p>
        <span className="text-[10px] text-[rgba(232,227,218,0.25)]">· by order date</span>
      </div>

      {error ? (
        <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)]">
          <p className="text-[11px] text-[rgba(232,227,218,0.40)]">{error}</p>
        </div>
      ) : !data ? (
        <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)]">
          <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Loading…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([["This month", data.month, data.unpriced.month],
             ["This year", data.year, data.unpriced.year]] as const).map(([label, d, unpriced]) => (
            <div key={label}
              className="p-4 rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)]">
              <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5">{label}</p>
              <p className="font-display text-[26px] text-[#e8e3da] leading-none">{money(d.total)}</p>
              <p className="text-[11px] text-[rgba(232,227,218,0.40)] mt-2">
                {d.orders} order{d.orders === 1 ? "" : "s"}
                {" · "}Shopify {money(d.shopify)}
                {" · "}Custom {money(d.custom)}
              </p>
              {unpriced > 0 && (
                /* A project ingested before the money columns existed sums as
                   zero while being a real order. Saying how many are missing
                   beats a total that quietly omits them. */
                <p className="text-[10px] mt-1.5" style={{ color: "#e8b56a" }}>
                  ⚠ {unpriced} order{unpriced === 1 ? "" : "s"} with no total recorded — backfill via Shopify sync
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RevenueBucket {
  shopify: number;
  custom: number;
  total: number;
  orders: number;
}
interface RevenueResponse {
  month: RevenueBucket;
  year: RevenueBucket;
  unpriced: { month: number; year: number };
}

export default function AdminPage() {
  const { data: session } = useSession();

  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  if (session && !isAdmin) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-cream/55 text-sm">Access denied. Admins only.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>

      <PageHeader
        eyebrow="Settings"
        title="Admin"
        accent="tools"
        right={
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cream/50" />
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-900/30 text-amber-300 border border-amber-700/40 uppercase tracking-wider">Admin</span>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 pb-12">

        {/* Admin tools - all buttons at the top */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="/admin/team"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">Team members</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Add, edit, and deactivate members; set roles, profiles, and passwords.</p>
          </a>
          <a href="/admin/shopify"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">Shopify sync</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Sync products from Shopify, import orders, backfill payment statuses.</p>
          </a>
          <a href="/admin/vendors"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">Vendors</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Manage vendor RMA contact emails for damage report drafts.</p>
          </a>
          <a href="/admin/mappings"
            className="group p-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(86,100,72,0.35)] transition-all">
            <p className="text-sm font-medium text-[#e8e3da] mb-1">SKU mappings</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.40)]">Assign SKU codes to Avis door styles, colors, and modifications - no deploy needed.</p>
          </a>
        </div>

        {/* The panel this slot was reserved for. It was blocked on whether
            alternate orders would get their own tables or a type
            discriminator, "because that decides whether this is one query or
            a union". It settled as a union, for a reason the comment could
            not have predicted: Shopify checkouts became PROJECTS, so their
            total lives there, while custom jobs stayed standalone rows and
            keep theirs on the order. */}
        <RevenuePanel />

        <AuditLog />
      </div>
    </AppShell>
  );
}
