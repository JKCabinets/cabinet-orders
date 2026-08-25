"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import {
  Order, Project, STAGE_ACCENT, STAGE_LIST_BY_TYPE, OrderType,
} from "@/lib/data";
import { attentionFor } from "@/lib/attention";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { Search } from "lucide-react";

/**
 * /projects — the purchase, not the work.
 *
 * A Shopify checkout is ONE project with one `orders` row per product category
 * beneath it. Everywhere else in the OMS you look at groups: /orders/cabinets
 * lists cabinet groups, /samples lists sample groups, the work queue lists
 * whatever needs someone. This is the only place the project is visible as
 * itself — one customer, one order number, one charge, several timelines.
 *
 * Opening a project opens the order modal, which IS the project hub: it shows
 * every group with its own stage and claim. So a row here is a doorway, not a
 * detail page — building a second project view would duplicate the modal.
 *
 * Custom jobs and warranty claims are NOT here. They have no project: a custom
 * job is contract work carrying no Shopify products, and a claim is about a
 * purchase rather than part of one.
 */

/** Group label per type, matching the modal's. */
const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
};

type RollupState = "new" | "in_progress" | "complete";

const ROLLUP_COPY: Record<RollupState, { label: string; color: string }> = {
  new: { label: "New", color: "#c97070" },
  in_progress: { label: "In progress", color: "#d4922a" },
  complete: { label: "Complete", color: "#8fbe70" },
};

/**
 * The project's state, DERIVED from its groups and never stored.
 *
 * ⚠ A SUMMARY, NOT A GATE. No group's status drives another's — cabinets in
 * production alongside samples delivered is a normal state, not a conflict.
 * This says where the purchase as a whole has got to; it does not stop
 * anything.
 *
 * Stored, it would be a fourth thing that can disagree with the three groups it
 * describes. Derived, it cannot.
 *
 * Archived groups still count. Archiving is filing, not finishing — a project
 * whose cabinets were archived early is still in progress while its samples are
 * open, and reporting it Complete would be a lie told to tidy a list.
 */
function rollup(groups: Order[]): RollupState {
  if (groups.length === 0) return "new";
  let anyStarted = false;
  let allTerminal = true;
  for (const g of groups) {
    const flow = (STAGE_LIST_BY_TYPE[g.type as OrderType] ?? []) as readonly string[];
    const first = flow[0];
    const last = flow[flow.length - 1];
    if (first && g.stage !== first) anyStarted = true;
    if (last && g.stage !== last) allTerminal = false;
  }
  if (allTerminal) return "complete";
  return anyStarted ? "in_progress" : "new";
}

export function ProjectsClient() {
  const { allOrders, projects } = useStore();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);

  // Group the rows by project once, rather than filtering allOrders per project.
  const groupsByProject = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of allOrders) {
      if (!o.project_id) continue;
      const list = map.get(o.project_id) ?? [];
      list.push(o);
      map.set(o.project_id, list);
    }
    return map;
  }, [allOrders]);

  const rows = useMemo(() => {
    const list = Object.values(projects) as Project[];
    const q = search.trim().toLowerCase();
    return list
      .filter((p) => {
        if (!q) return true;
        return (
          p.id.toLowerCase().includes(q) ||
          String(p.name ?? "").toLowerCase().includes(q) ||
          String(p.customer_email ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [projects, search]);

  const money = (n: number | string | null | undefined) =>
    n === null || n === undefined
      ? null
      : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader eyebrow="Shopify purchases" title="Projects" accent="hub" />

      <div className="px-6 lg:px-8 pb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order number, customer or email…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="projects-search-no-autofill"
            className="field-glass w-full pl-9 pr-4 py-2 rounded-full text-[13px] transition-colors"
            style={{ fontSize: "16px" }}
          />
        </div>
      </div>

      <div className="px-6 lg:px-8 pb-12">
        {rows.length === 0 ? (
          <div className="glass rounded-brand p-10 text-center">
            <div className="font-display text-[22px] text-cream/70 mb-1">
              {search ? "No matches" : "No projects yet"}
            </div>
            <div className="text-[12px] text-cream/45">
              {search
                ? `Nothing matched "${search}".`
                : "Projects arrive from Shopify checkouts."}
            </div>
          </div>
        ) : (
          <div
            className="rounded-panel overflow-hidden"
            style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}
          >
            <div
              className="grid grid-cols-[0.9fr_1.1fr_1.7fr_0.7fr_0.7fr] gap-3 px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span>Order</span>
              <span>Customer</span>
              <span>Pipelines</span>
              <span className="text-right">Total</span>
              <span className="text-right">State</span>
            </div>

            {rows.map((p) => {
              const groups = groupsByProject.get(p.id) ?? [];
              const state = rollup(groups);
              const copy = ROLLUP_COPY[state];
              const total = money(p.total_price);
              // Anything in this project wanting a person. Shown as a dot
              // rather than a count: the work queue is where you act on it,
              // this is only a reason to look.
              const wants = groups.some((g) => attentionFor(g).length > 0);

              return (
                <button
                  key={p.id}
                  onClick={() => groups[0] && setSelected(groups[0])}
                  disabled={groups.length === 0}
                  className="w-full grid grid-cols-[0.9fr_1.1fr_1.7fr_0.7fr_0.7fr] gap-3 px-4 py-3 text-left transition-colors hover:bg-white/4 disabled:opacity-50"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}
                >
                  <span className="self-center flex items-center gap-1.5 min-w-0">
                    {wants && (
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: "#e08585" }}
                        title="Something in this project needs attention"
                      />
                    )}
                    <span className="text-[11px] font-mono text-cream/80 truncate">{p.id}</span>
                  </span>

                  <span className="self-center min-w-0">
                    <span className="block text-[12px] text-cream/85 truncate">{p.name ?? "—"}</span>
                    {p.customer_email && (
                      <span className="block text-[10px] text-cream/35 truncate">{p.customer_email}</span>
                    )}
                  </span>

                  {/* One chip per group, each carrying its OWN stage. This is
                      the whole point of the project view: two timelines under
                      one order number, neither waiting on the other. */}
                  <span className="self-center flex items-center gap-1.5 flex-wrap">
                    {groups.length === 0 ? (
                      <span className="text-[10px] text-cream/30 italic">no groups</span>
                    ) : (
                      groups.map((g) => {
                        const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";
                        return (
                          <span
                            key={g.id}
                            className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              border: `0.5px solid ${accent}44`,
                              color: "rgba(232,227,218,0.75)",
                            }}
                          >
                            {GROUP_LABEL[g.type] ?? g.type}
                            <span className="mx-1 opacity-40">·</span>
                            <span style={{ color: accent }}>{g.stage}</span>
                          </span>
                        );
                      })
                    )}
                  </span>

                  <span className="self-center text-right text-[11px] tabular-nums">
                    {total ? (
                      <span className="text-cream/70">{total}</span>
                    ) : (
                      /* Nullable money means UNKNOWN, not zero. Rendering a
                         dash rather than $0.00 keeps a project ingested before
                         the money columns existed from reading as free. */
                      <span className="text-cream/25" title="No total recorded">—</span>
                    )}
                  </span>

                  <span className="self-center text-right">
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{
                        background: `${copy.color}1f`,
                        border: `0.5px solid ${copy.color}55`,
                        color: copy.color,
                      }}
                    >
                      {copy.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onStageChange={(s) => setSelected((prev) => (prev ? { ...prev, stage: s } : null))}
        />
      )}
    </>
  );
}
