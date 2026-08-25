"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import {
  Order, Project, STAGE_ACCENT, STAGE_LIST_BY_TYPE, OrderType,
  isPaymentHoldStatus,
} from "@/lib/data";
import { attentionFor, type AttentionReason } from "@/lib/attention";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AvatarWithProfile } from "@/components/AvatarWithProfile";
import {
  Search, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, ArrowRight,
  Archive, RotateCcw, Loader2,
} from "lucide-react";
import clsx from "clsx";

/**
 * /projects — the hub for everything that came from Shopify.
 *
 * A checkout is ONE project with one `orders` row per product category. Every
 * other page looks at groups: /orders/cabinets lists cabinet groups, the work
 * queue lists whatever needs someone. This is the only place the purchase is
 * visible as itself — one customer, one charge, several timelines that do not
 * wait on each other.
 *
 * ⚠ EXPANDING A ROW IS THE POINT. The collapsed row answers "is this fine?";
 * the expansion answers "what is each part actually doing?". A project whose
 * cabinets are in production while its hardware is delivered is NORMAL, and a
 * summary that flattened those into one status would be hiding the thing the
 * project model exists to show.
 *
 * Custom jobs and warranty claims are NOT here. A custom job carries no Shopify
 * products; a claim is about a purchase rather than part of one. Both are
 * standalone rows with a NULL project_id.
 */

const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
};

const GROUP_DOT: Record<string, string> = {
  order: "#e08585",
  hardware: "#e8b56a",
  sample: "#5a8db8",
};

type Filter = "all" | "active" | "attention" | "complete" | "refunded" | "archived";

const FILTERS: { key: Filter; label: string; dot?: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", dot: "#8fbe70" },
  { key: "attention", label: "Needs attention", dot: "#e8b56a" },
  { key: "complete", label: "Complete", dot: "#8fbe70" },
  { key: "refunded", label: "Refunded", dot: "#e08585" },
  { key: "archived", label: "Archived" },
];

/** Is this group at the last stage of its own flow? */
function isDelivered(g: Order): boolean {
  const flow = (STAGE_LIST_BY_TYPE[g.type as OrderType] ?? []) as readonly string[];
  return flow.length > 0 && g.stage === flow[flow.length - 1];
}

/** Is this group still at the first stage of its own flow? */
function isUnstarted(g: Order): boolean {
  const flow = (STAGE_LIST_BY_TYPE[g.type as OrderType] ?? []) as readonly string[];
  return flow.length > 0 && g.stage === flow[0];
}

/**
 * What happens next for this group, in words.
 *
 * Reads the date that actually governs the next transition rather than
 * inventing a milestone: production's finish date is what the
 * production-complete cron acts on, and the delivery date is what the Confirm
 * Delivery button needs. A group with neither has nothing scheduled, and says
 * so instead of showing a blank.
 */
function nextMilestone(g: Order): { label: string; detail?: string } {
  if (isDelivered(g)) {
    return { label: "Delivered", detail: g.delivery_date ?? undefined };
  }
  if (g.stage === "In production" && g.production_est_finish_date) {
    return { label: "Estimated production complete", detail: g.production_est_finish_date };
  }
  if (g.scheduled_delivery_date || g.delivery_date) {
    return { label: "Scheduled delivery", detail: g.scheduled_delivery_date ?? g.delivery_date ?? undefined };
  }
  if (g.type === "hardware" && g.tracking_number) {
    return { label: "In transit", detail: g.carrier ?? undefined };
  }
  return { label: "Nothing scheduled" };
}

export function ProjectsClient() {
  const { allOrders, projects, team, archiveProject } = useStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Why the server refused, keyed by project. Shown inline on the row. */
  const [refusal, setRefusal] = useState<Record<string, string>>({});

  const groupsByProject = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of allOrders) {
      if (!o.project_id) continue;
      const list = map.get(o.project_id) ?? [];
      list.push(o);
      map.set(o.project_id, list);
    }
    // Cabinets, hardware, samples — the order the modal uses, so a project
    // reads the same everywhere.
    const rank: Record<string, number> = { order: 0, hardware: 1, sample: 2 };
    for (const list of map.values()) {
      list.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
    }
    return map;
  }, [allOrders]);

  /** Everything a project row needs, computed once. */
  const enriched = useMemo(() => {
    return (Object.values(projects) as Project[]).map((p) => {
      const groups = groupsByProject.get(p.id) ?? [];
      const reasons: AttentionReason[] = groups.flatMap((g) => attentionFor(g));
      const delivered = groups.filter(isDelivered).length;
      const refunded = isPaymentHoldStatus(p.payment_status);
      const complete = groups.length > 0 && delivered === groups.length;
      const started = groups.some((g) => !isUnstarted(g));
      return { project: p, groups, reasons, delivered, refunded, complete, started,
               archived: !!p.archived };
    });
  }, [projects, groupsByProject]);

  // ⚠ ARCHIVED IS EXCLUDED FROM EVERY OTHER BUCKET, including All. Archiving
  // means "this purchase is finished and off the board" -- a project that kept
  // showing under All after being archived would make the action look broken,
  // which is exactly what an archive is for avoiding.
  const counts = useMemo(() => {
    const live = enriched.filter((e) => !e.archived);
    return {
      all: live.length,
      active: live.filter((e) => !e.complete && !e.refunded).length,
      attention: live.filter((e) => e.reasons.length > 0).length,
      complete: live.filter((e) => e.complete).length,
      refunded: live.filter((e) => e.refunded).length,
      archived: enriched.filter((e) => e.archived).length,
    };
  }, [enriched]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((e) => {
        // Archived rows appear ONLY under their own filter.
        if (filter === "archived") { if (!e.archived) return false; }
        else if (e.archived) return false;
        if (filter === "active" && (e.complete || e.refunded)) return false;
        if (filter === "attention" && e.reasons.length === 0) return false;
        if (filter === "complete" && !e.complete) return false;
        if (filter === "refunded" && !e.refunded) return false;
        if (!q) return true;
        return (
          e.project.id.toLowerCase().includes(q) ||
          String(e.project.name ?? "").toLowerCase().includes(q) ||
          String(e.project.customer_email ?? "").toLowerCase().includes(q) ||
          String(e.project.ship_to ?? "").toLowerCase().includes(q) ||
          e.groups.some((g) => g.id.toLowerCase().includes(q))
        );
      })
      .sort((a, b) =>
        String(b.project.created_at).localeCompare(String(a.project.created_at)));
  }, [enriched, filter, search]);


  /**
   * Archive or restore, and surface a refusal rather than swallowing it.
   *
   * The server gate is the real one: every group at the last stage of its own
   * flow, or the purchase refunded. When it says no it names the orders that
   * are not finished, which is worth showing verbatim -- "2 orders in this
   * project are not finished yet: SHO-1050-CAB (In production)" tells you what
   * to do next, where "could not archive" does not.
   */
  async function doArchive(id: string, archived: boolean) {
    setBusyId(id);
    setRefusal((prev) => { const n = { ...prev }; delete n[id]; return n; });
    const res = await archiveProject(id, archived);
    setBusyId(null);
    if (!res.ok && res.message) {
      setRefusal((prev) => ({ ...prev, [id]: res.message! }));
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /**
   * ⚠ A MISSING TOTAL RENDERS AS $0.00, by decision.
   *
   * Nullable money means UNKNOWN in the database and that distinction is real —
   * free shipping is genuinely zero. It is preserved where it changes an
   * answer: /admin counts unpriced projects separately, so a revenue figure
   * that is low because six projects predate the money columns says so there.
   * On this page a dash read as a bug, so it shows a number.
   */
  const money = (n: number | string | null | undefined) =>
    (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

  const dateOf = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  const GRID = "grid grid-cols-[24px_0.85fr_0.7fr_1fr_1.5fr_1.1fr_0.9fr_0.7fr_0.6fr_34px] gap-3";

  return (
    <>
      <PageHeader
        eyebrow="Shopify"
        title="Projects"
        accent="hub"
      />

      <div className="px-6 lg:px-8 pb-2">
        <p className="text-[12px] text-cream/45 -mt-2 mb-4">
          Customer purchases from Shopify and their associated orders.
        </p>

        {/* Filters */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all",
                filter === f.key
                  ? "bg-terracotta/20 border border-terracotta/55 text-terracotta"
                  : "bg-white/4 border border-cream/15 text-cream/60 hover:bg-white/8",
              )}
            >
              {f.dot && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: f.dot }} />
              )}
              {f.label}
              <span className="opacity-65 tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative max-w-lg mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, customer, order #, address…"
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
              {search || filter !== "all" ? "No matches" : "No projects yet"}
            </div>
            <div className="text-[12px] text-cream/45">
              {search
                ? `Nothing matched "${search}".`
                : filter !== "all"
                  ? "No projects in this filter."
                  : "Projects arrive from Shopify checkouts."}
            </div>
          </div>
        ) : (
          <div className="rounded-panel overflow-hidden" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
            <div
              className={`${GRID} px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40`}
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span />
              <span>Project</span>
              <span>Date</span>
              <span>Customer</span>
              <span>Orders</span>
              <span>Attention</span>
              <span>Fulfillment</span>
              <span className="text-right">Total</span>
              <span className="text-right">Payment</span>
              <span />
            </div>

            {rows.map(({ project: p, groups, reasons, delivered, refunded, complete, archived }) => {
              const open = expanded.has(p.id);
              const lead = reasons.find((r) => r.severity === "high") ?? reasons[0];
              const pct = groups.length > 0 ? (delivered / groups.length) * 100 : 0;

              return (
                <div key={p.id} style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                  <button
                    onClick={() => toggle(p.id)}
                    className={`${GRID} w-full px-4 py-3 text-left transition-colors hover:bg-white/4`}
                  >
                    <span className="self-center text-cream/40">
                      {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>

                    <span className="self-center min-w-0">
                      <span className="block text-[13px] font-mono text-cream/90 truncate">{p.id}</span>
                      <span className="block text-[10px] text-cream/35">
                        {p.source === "Shopify" ? "Web order" : p.source ?? "—"}
                      </span>
                    </span>

                    <span className="self-center text-[11px] text-cream/55">{dateOf(p.created_at)}</span>

                    <span className="self-center min-w-0">
                      <span className="block text-[12px] text-cream/85 truncate">{p.name ?? "—"}</span>
                      {p.ship_to && (
                        <span className="block text-[10px] text-cream/35 truncate">{p.ship_to}</span>
                      )}
                    </span>

                    {/* One line per group: category, its OWN stage, its OWN
                        owner. Three timelines under one order number, none
                        waiting on another. */}
                    <span className="self-center flex flex-col gap-1 min-w-0">
                      {groups.length === 0 ? (
                        <span className="text-[10px] text-cream/30 italic">no orders</span>
                      ) : groups.map((g) => {
                        const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";
                        const owner = g.claimed_by ? team.find((m) => m.id === g.claimed_by) : undefined;
                        return (
                          <span key={g.id} className="flex items-center gap-1.5 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: GROUP_DOT[g.type] ?? "#8a8a8a" }} />
                            <span className="text-[11px] text-cream/70 w-[62px] flex-shrink-0">
                              {GROUP_LABEL[g.type] ?? g.type}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              style={{ background: `${accent}1f`, border: `0.5px solid ${accent}55`, color: accent }}>
                              {g.stage}
                            </span>
                            {owner
                              ? <span className="flex items-center gap-1 min-w-0">
                                  <AvatarWithProfile member={owner} size="sm" />
                                  <span className="text-[10px] text-cream/45 truncate">{owner.name.split(" ")[0]}</span>
                                </span>
                              : <span className="text-[10px] text-cream/25 italic">Unclaimed</span>}
                          </span>
                        );
                      })}
                    </span>

                    <span className="self-center min-w-0">
                      {reasons.length === 0 ? (
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#8fbe70" }} />
                          <span className="text-[11px]" style={{ color: "#8fbe70" }}>No issues</span>
                        </span>
                      ) : (
                        <span className="flex items-start gap-1.5 min-w-0">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px"
                            style={{ color: lead.severity === "high" ? "#e08585" : "#e8b56a" }} />
                          <span className="min-w-0">
                            <span className="block text-[11px] truncate"
                              style={{ color: lead.severity === "high" ? "#e08585" : "#e8b56a" }}>
                              {reasons.length} needs attention
                            </span>
                            <span className="block text-[10px] text-cream/40 truncate">{lead.label}</span>
                          </span>
                        </span>
                      )}
                    </span>

                    <span className="self-center min-w-0">
                      <span className="block text-[11px] text-cream/60 mb-1">
                        {delivered} / {groups.length} delivered
                      </span>
                      <span className="block h-1 rounded-full overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.08)" }}>
                        <span className="block h-full rounded-full"
                          style={{ width: `${pct}%`, background: "#8fbe70" }} />
                      </span>
                    </span>

                    <span className="self-center text-right text-[12px] tabular-nums text-cream/85">
                      {money(p.total_price)}
                    </span>

                    <span className="self-center text-right">
                      <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={refunded
                          ? { background: "rgba(224,85,85,0.16)", border: "0.5px solid rgba(224,85,85,0.45)", color: "#e08585" }
                          : { background: "rgba(143,190,112,0.14)", border: "0.5px solid rgba(143,190,112,0.35)", color: "#a0cc7a" }}>
                        {p.payment_status ?? "—"}
                      </span>
                    </span>

                    {/* Archive / restore.
                        ⚠ A <div role="button">, not a <button> -- this sits
                        inside the row's expand button, and a button inside a
                        button is invalid HTML that React warns about and
                        browsers nest unpredictably.

                        Offered only when the project CAN be archived: every
                        order delivered, or the purchase refunded. Hiding it
                        otherwise is not the gate -- the server refuses too --
                        but a control that is always visible and usually fails
                        teaches people to ignore it. */}
                    <span className="self-center flex justify-end">
                      {(archived || complete || refunded) && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void doArchive(p.id, !archived); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault(); e.stopPropagation();
                              void doArchive(p.id, !archived);
                            }
                          }}
                          className="p-1.5 rounded-full transition-colors hover:bg-white/10 cursor-pointer"
                          title={archived ? "Restore to the board" : "Archive this purchase"}
                        >
                          {busyId === p.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cream/50" />
                            : archived
                              ? <RotateCcw className="w-3.5 h-3.5 text-cream/45" />
                              : <Archive className="w-3.5 h-3.5 text-cream/45" />}
                        </div>
                      )}
                    </span>
                  </button>

                  {/* Why the server said no. Inline on the row rather than a
                      toast: the refusal names the orders that are not finished,
                      and that is only useful next to them. */}
                  {refusal[p.id] && (
                    <div className="px-4 pb-2 -mt-1">
                      <p className="text-[11px]" style={{ color: "#e8b56a" }}>{refusal[p.id]}</p>
                    </div>
                  )}

                  {/* Expansion: each order in the project, with what it is
                      waiting on. */}
                  {open && groups.length > 0 && (
                    <div className="px-4 pb-3">
                      <div className="rounded-brand overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
                        <div className="grid grid-cols-[1fr_0.7fr_0.7fr_0.9fr_1.4fr_0.8fr_0.9fr_28px] gap-3 px-3 py-2 text-[9px] uppercase tracking-wider text-cream/35">
                          <span>Order #</span>
                          <span>Type</span>
                          <span>Status</span>
                          <span>Owner</span>
                          <span>SLA / next milestone</span>
                          <span>Est. / actual</span>
                          <span>Attention</span>
                          <span />
                        </div>
                        {groups.map((g) => {
                          const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";
                          const owner = g.claimed_by ? team.find((m) => m.id === g.claimed_by) : undefined;
                          const gr = attentionFor(g);
                          const glead = gr.find((r) => r.severity === "high") ?? gr[0];
                          const ms = nextMilestone(g);
                          return (
                            <button
                              key={g.id}
                              onClick={() => setSelected(g)}
                              className="w-full grid grid-cols-[1fr_0.7fr_0.7fr_0.9fr_1.4fr_0.8fr_0.9fr_28px] gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/4"
                              style={{ borderTop: "0.5px solid rgba(255,255,255,0.06)" }}
                            >
                              <span className="self-center text-[11px] font-mono text-cream/70 truncate">{g.id}</span>
                              <span className="self-center flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ background: GROUP_DOT[g.type] ?? "#8a8a8a" }} />
                                <span className="text-[11px] text-cream/65">{GROUP_LABEL[g.type] ?? g.type}</span>
                              </span>
                              <span className="self-center">
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  style={{ background: `${accent}1f`, border: `0.5px solid ${accent}55`, color: accent }}>
                                  {g.stage}
                                </span>
                              </span>
                              <span className="self-center flex items-center gap-1.5 min-w-0">
                                {owner
                                  ? <>
                                      <AvatarWithProfile member={owner} size="sm" />
                                      <span className="text-[10px] text-cream/55 truncate">{owner.name}</span>
                                    </>
                                  : <span className="text-[10px] text-cream/25 italic">Unclaimed</span>}
                              </span>
                              <span className="self-center min-w-0">
                                <span className="block text-[11px] text-cream/75 truncate">{ms.label}</span>
                                {ms.detail && (
                                  <span className="block text-[10px] text-cream/35 truncate">{ms.detail}</span>
                                )}
                              </span>
                              <span className="self-center text-[11px] text-cream/55 truncate">
                                {g.delivery_date ?? g.scheduled_delivery_date ?? g.production_est_finish_date ?? "—"}
                              </span>
                              <span className="self-center flex items-center gap-1.5 min-w-0">
                                {gr.length === 0 ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "#8fbe70" }} />
                                    <span className="text-[10px] truncate" style={{ color: "#8fbe70" }}>
                                      {isDelivered(g) ? "Complete" : "Healthy"}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="w-3 h-3 flex-shrink-0"
                                      style={{ color: glead.severity === "high" ? "#e08585" : "#e8b56a" }} />
                                    <span className="text-[10px] truncate"
                                      style={{ color: glead.severity === "high" ? "#e08585" : "#e8b56a" }}>
                                      {glead.label}
                                    </span>
                                  </>
                                )}
                              </span>
                              <span className="self-center text-cream/25">
                                <ArrowRight className="w-3.5 h-3.5" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-cream/35 mt-3">
          Showing {rows.length} of {enriched.length} project{enriched.length === 1 ? "" : "s"}
        </p>
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
