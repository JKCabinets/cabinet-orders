"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import { Order, Project, STAGE_ACCENT, displayOrderNumber } from "@/lib/data";
import {
  attentionFor, attentionForProject,
  type AttentionKind, type AttentionReason,
} from "@/lib/attention";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AvatarWithProfile } from "@/components/AvatarWithProfile";
import { useToast } from "@/components/Toast";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import clsx from "clsx";

/**
 * The work queue — what needs someone, grouped by what you'd claim.
 *
 * ⚠ ROWS ARE PURCHASES, NOT ORDERS.
 *
 * The claim moved up to the project on 2026-08-25: one owner per purchase, so
 * a designer who has finished the cabinets is not blocked from closing it while
 * somebody else sits on the hardware. The queue follows the claim — a row here
 * is a thing you can take, and taking it takes all of it.
 *
 * Custom jobs and warranty claims have no project. They appear as single rows
 * alongside, which is the same split the sidebar makes: Shopify above, offline
 * and service below.
 *
 * ⚠ THE HIERARCHY IS DELIBERATE: why I care → what → where → who.
 * The stage pages lead with the customer, which is right when you are looking
 * up an order and wrong when you are working a queue.
 *
 * Every reason comes from `lib/attention.ts`. This page holds no predicates of
 * its own, so its rows and the dashboard's counts cannot disagree.
 */

const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
  custom: "Custom job",
  warranty: "Warranty claim",
};

const GROUP_DOT: Record<string, string> = {
  order: "#e08585",
  hardware: "#e8b56a",
  sample: "#5a8db8",
  custom: "#b8a05a",
  warranty: "#8fbe70",
};

type Scope = "mine" | "unclaimed";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "mine", label: "My work" },
  { key: "unclaimed", label: "Unclaimed" },
];

const REASON_FILTERS: { key: AttentionKind | null; label: string }[] = [
  { key: null, label: "Everything" },
  { key: "sla_breached", label: "Past SLA" },
  { key: "blocked_missing_data", label: "Blocked" },
  { key: "sla_due_soon", label: "Due soon" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "payment_hold", label: "Payment hold" },
];

/** A queue entry: a purchase with its orders, or a standalone row. */
interface Entry {
  key: string;
  /** Present for a Shopify purchase; absent for custom and warranty. */
  project?: Project;
  /** The orders beneath a project, or the single standalone row. */
  orders: Order[];
  reasons: AttentionReason[];
  claimedBy: string | null;
  /** What the row is called: the project number, or the order number. */
  label: string;
  customer: string;
}

export function WorkClient({ initialScope = "mine" }: { initialScope?: Scope }) {
  const { allOrders, projects, team, claimProject, claimOrder } = useStore();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [scope, setScope] = useState<Scope>(initialScope);
  const [reason, setReason] = useState<AttentionKind | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);

  /** Every entry that wants somebody, before scope and reason filtering. */
  const allEntries = useMemo(() => {
    const out: Entry[] = [];

    const byProject = new Map<string, Order[]>();
    const standalone: Order[] = [];
    for (const o of allOrders) {
      if (o.archived) continue;
      if (o.project_id) {
        const list = byProject.get(o.project_id) ?? [];
        list.push(o);
        byProject.set(o.project_id, list);
      } else {
        standalone.push(o);
      }
    }

    for (const [projectId, orders] of byProject) {
      const project = projects[projectId];
      if (!project || project.archived) continue;
      const reasons = attentionForProject(project, orders);
      // ⚠ NOT `if (reasons.length === 0) continue` any more.
      //
      // My Work is a hub for everything you own, not a list of what is on fire
      // in it. An empty My Work used to mean "nothing you own needs anything",
      // which reads as "you own nothing" -- the opposite of true, and the tab
      // is named for ownership.
      //
      // The SCOPE filter below drops the ones that do not belong here:
      // Unclaimed stays exceptions-only, because an unclaimed purchase ticking
      // along fine needs nobody, and listing all seven would bury the four that
      // do. The two tabs answer different questions on purpose.
      const rank: Record<string, number> = { order: 0, hardware: 1, sample: 2 };
      orders.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
      out.push({
        key: projectId,
        project,
        orders,
        reasons,
        claimedBy: project.claimed_by ?? null,
        label: projectId,
        customer: project.name ?? "—",
      });
    }

    for (const o of standalone) {
      // Listed whether or not anything is wrong -- a custom job you own with
      // nothing outstanding is still yours. The scope filter decides.
      const reasons = attentionFor(o);
      out.push({
        key: o.id,
        orders: [o],
        reasons,
        claimedBy: o.claimed_by ?? null,
        label: displayOrderNumber(o),
        customer: o.name,
      });
    }

    return out;
  }, [allOrders, projects]);

  const rows = useMemo(() => {
    return allEntries
      .filter((e) => {
        if (scope === "mine") {
          // Everything you own, whether or not anything is wrong with it.
          if (e.claimedBy !== currentUserId) return false;
        } else {
          // Unclaimed: exceptions only. Something nobody owns AND nothing is
          // wrong with is not work -- it is just an order.
          if (e.claimedBy) return false;
          if (e.reasons.length === 0) return false;
        }
        if (reason && !e.reasons.some((r) => r.kind === reason)) return false;
        return true;
      })
      .sort((a, b) => {
        // Trouble first, then anything else with a reason, then the calm ones.
        // On My Work this is what keeps a hub from burying the one thing that
        // actually needs you under nine that do not.
        const rank = (e: Entry) =>
          e.reasons.some((r) => r.severity === "high") ? 0
          : e.reasons.length > 0 ? 1
          : 2;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.reasons.length - a.reasons.length;
      });
  }, [allEntries, scope, reason, currentUserId]);

  const scopeCounts = useMemo(() => {
    const c: Record<Scope, number> = { mine: 0, unclaimed: 0 };
    for (const e of allEntries) {
      // Mirrors the filter above exactly. A tab whose count disagrees with what
      // it shows is worse than no count.
      if (e.claimedBy === currentUserId && currentUserId) c.mine++;
      else if (!e.claimedBy && e.reasons.length > 0) c.unclaimed++;
    }
    return c;
  }, [allEntries, currentUserId]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /**
   * Claim or release an entry.
   *
   * A purchase goes through claimProject; a standalone row through claimOrder.
   * Two mechanisms because there are genuinely two things -- but the button is
   * one, so nobody has to know which they are looking at.
   */
  async function toggleClaim(e: Entry) {
    if (!currentUserId) return;
    setBusyKey(e.key);
    const wantsClaim = !e.claimedBy;
    try {
      if (e.project) {
        const res = await claimProject(e.project.id, wantsClaim);
        if (!res.ok) {
          const holder = res.claimedBy ? team.find((m) => m.id === res.claimedBy) : undefined;
          showToast(
            res.reason === "already_claimed"
              ? `Already claimed by ${holder?.name ?? "someone else"}`
              : res.reason === "not_owner"
                ? "You can't release someone else's claim"
                : "Could not update the claim",
            { kind: "warn" },
          );
        }
      } else {
        await claimOrder(e.orders[0].id, wantsClaim ? currentUserId : null);
      }
    } finally {
      setBusyKey(null);
    }
  }

  const GRID = "grid grid-cols-[24px_1.5fr_0.9fr_1fr_1.3fr_0.8fr] gap-3";

  return (
    <AppShell>
      <PageHeader eyebrow="Needs someone" title="Work" accent="queue" />

      <div className="px-6 lg:px-8 pb-12">
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              className="px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-medium transition-all"
              style={
                scope === s.key
                  ? { background: "rgba(184,130,106,0.20)", border: "0.5px solid rgba(184,130,106,0.55)", color: "#d9a888" }
                  : { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(232,227,218,0.55)" }
              }
            >
              {s.label}
              <span className="ml-1.5 tabular-nums opacity-70">{scopeCounts[s.key]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 mb-4 flex-wrap">
          {REASON_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setReason(f.key)}
              className={clsx(
                "px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider transition-all",
                reason === f.key ? "text-cream" : "text-cream/40 hover:text-cream/70",
              )}
              style={{
                background: reason === f.key ? "rgba(255,255,255,0.08)" : "transparent",
                border: "0.5px solid " + (reason === f.key ? "rgba(255,255,255,0.20)" : "transparent"),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div
            className="rounded-panel px-6 py-10 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.10)" }}
          >
            <p className="text-[13px] text-cream/55">Nothing needs you here.</p>
            <p className="text-[11px] text-cream/30 mt-1">
              {scope === "mine"
                ? "Work you have claimed is all on track."
                : "Everything unclaimed is on track."}
            </p>
          </div>
        ) : (
          <div className="rounded-panel overflow-hidden" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
            <div
              className={`${GRID} px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40`}
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span />
              <span>Issue</span>
              <span>Order</span>
              <span>Customer</span>
              <span>Orders in it</span>
              <span className="text-right">Owner</span>
            </div>

            {rows.map((e) => {
              const open = expanded.has(e.key);
              const unclaimed = e.reasons.find((r) => r.kind === "unclaimed");
              // An unowned entry leads with that: the breach beneath it is a
              // CONSEQUENCE of nobody having picked it up, and "Unclaimed 5d"
              // says what to do where "Past SLA" only says it is late.
              // An entry you own with nothing wrong has no reason to lead
               // with. It still belongs on the page -- it is yours -- so it
               // says so plainly rather than borrowing an alarm colour.
              const lead = (!e.claimedBy && unclaimed)
                ? unclaimed
                : e.reasons.find((r) => r.severity === "high") ?? e.reasons[0]
                  ?? { kind: "ok" as const, severity: "medium" as const, label: "On track", detail: undefined };
              const owner = e.claimedBy ? team.find((m) => m.id === e.claimedBy) : undefined;
              const mine = !!currentUserId && e.claimedBy === currentUserId;

              return (
                <div key={e.key} style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                  <div className={`${GRID} px-4 py-3 transition-colors hover:bg-white/4`}>
                    <button
                      onClick={() => toggle(e.key)}
                      className="self-center text-cream/40 hover:text-cream/70 transition-colors"
                      aria-label={open ? "Collapse" : "Expand"}
                    >
                      {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>

                    <button onClick={() => toggle(e.key)} className="text-left flex items-start gap-2 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                        style={{ background: lead.severity === "high" ? "#e08585" : "#e8b56a" }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] text-cream/90 truncate">{lead.label}</span>
                        {lead.detail && (
                          <span className="block text-[10px] text-cream/40 truncate">{lead.detail}</span>
                        )}
                        {e.reasons.length > 1 && (
                          <span className="block text-[9px] text-cream/30">
                            +{e.reasons.length - 1} more
                          </span>
                        )}
                      </span>
                    </button>

                    <button onClick={() => toggle(e.key)} className="text-left self-center min-w-0">
                      <span className="text-[11px] font-mono text-cream/70 truncate">{e.label}</span>
                    </button>

                    <button onClick={() => toggle(e.key)} className="text-left self-center min-w-0">
                      <span className="text-[11px] text-cream/60 truncate">{e.customer}</span>
                    </button>

                    <button onClick={() => toggle(e.key)} className="text-left self-center flex items-center gap-1.5 flex-wrap min-w-0">
                      {e.orders.map((o) => {
                        const accent = STAGE_ACCENT[o.stage] ?? "#8a8a8a";
                        return (
                          <span
                            key={o.id}
                            className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: "rgba(255,255,255,0.05)", border: `0.5px solid ${accent}44` }}
                          >
                            <span className="text-cream/60">{GROUP_LABEL[o.type] ?? o.type}</span>
                            <span className="mx-1 opacity-30">·</span>
                            <span style={{ color: accent }}>{o.stage}</span>
                          </span>
                        );
                      })}
                    </button>

                    {/* Claim is the point of the row: one owner takes the whole
                        purchase. Not inside the expand button -- a button
                        inside a button is invalid HTML. */}
                    <span className="self-center flex items-center justify-end gap-1.5 min-w-0">
                      {owner && (
                        <>
                          <AvatarWithProfile member={owner} size="sm" />
                          <span className="text-[10px] text-cream/45 truncate hidden lg:inline">
                            {owner.name.split(" ")[0]}
                          </span>
                        </>
                      )}
                      {(!e.claimedBy || mine) && (
                        <button
                          onClick={() => void toggleClaim(e)}
                          disabled={busyKey === e.key}
                          className="px-2 py-1 rounded-full text-[9px] uppercase tracking-wider font-medium transition-all disabled:opacity-40 flex-shrink-0"
                          style={
                            mine
                              ? { background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.18)", color: "rgba(232,227,218,0.65)" }
                              : { background: "rgba(184,130,106,0.20)", border: "0.5px solid rgba(184,130,106,0.55)", color: "#d9a888" }
                          }
                        >
                          {busyKey === e.key
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : mine ? "Release" : "Claim"}
                        </button>
                      )}
                    </span>
                  </div>

                  {open && (
                    <div className="px-4 pb-3 pl-11 flex flex-col gap-1.5">
                      {e.orders.map((o) => {
                        const accent = STAGE_ACCENT[o.stage] ?? "#8a8a8a";
                        const own = attentionFor(o);
                        return (
                          <button
                            key={o.id}
                            onClick={() => setSelected(o)}
                            className="flex items-center gap-3 rounded-brand px-3 py-2 text-left transition-colors hover:bg-white/4"
                            style={{ border: "0.5px solid rgba(255,255,255,0.10)" }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: GROUP_DOT[o.type] ?? "#8a8a8a" }} />
                            <span className="text-[11px] text-cream/70 w-[76px] flex-shrink-0">
                              {GROUP_LABEL[o.type] ?? o.type}
                            </span>
                            <span className="text-[10px] font-mono text-cream/40 w-[120px] flex-shrink-0 truncate">
                              {o.id}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: `${accent}1f`, border: `0.5px solid ${accent}55`, color: accent }}>
                              {o.stage}
                            </span>
                            <span className="text-[10px] truncate min-w-0"
                              style={{ color: own.length > 0 ? "#e8b56a" : "rgba(232,227,218,0.30)" }}>
                              {own.length > 0 ? own[0].label : "Nothing outstanding"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onStageChange={() => setSelected(null)}
        />
      )}
    </AppShell>
  );
}
