"use client";

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

        {/* ---------------------------------------------------------------
            SALES METRICS PANEL GOES HERE - backlog OMS #3, second half.
            Current year + current month: sell totals and job counts, for
            standard and custom orders only. Blocked until the Alternate
            Orders data model is settled (own tables vs. a type
            discriminator on `orders`), because that decides whether this
            is one query or a union.
            --------------------------------------------------------------- */}

        <AuditLog />
      </div>
    </AppShell>
  );
}
