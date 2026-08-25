"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  Order, STAGE_ACCENT, displayOrderNumber, AVATAR_COLOR_STYLES,
} from "@/lib/data";
import { attentionFor, type AttentionKind, type AttentionReason } from "@/lib/attention";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AvatarWithProfile } from "@/components/AvatarWithProfile";
import clsx from "clsx";

/**
 * The work queue — what needs someone, ordered by why.
 *
 * ⚠ THE HIERARCHY IS DELIBERATE AND IT IS REVERSED FROM THE OLD CARDS.
 *
 *     why I care → what order → where it is → who owns it → next action
 *
 * The stage pages lead with the customer name, which is right when you are
 * looking up a specific order and wrong when you are working a queue. Here the
 * ISSUE leads: "Delivery date required" is the reason the row is in front of
 * you, and the order number is how you find it afterwards.
 *
 * Every reason comes from `lib/attention.ts`. This page holds no predicates of
 * its own -- the dashboard counts and these rows must agree, and two filters
 * that happen to agree today are the drift this codebase keeps producing.
 *
 * GROUPS, NOT ORDERS. A cabinet group and a sample group of one checkout are
 * claimed and worked separately, so they queue separately. SHO-1050-CAB
 * needing an acknowledgment says nothing about SHO-1050-SMP.
 */

/** Human label per row type, matching the modal and the projects page. */
const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
  custom: "Custom job",
  warranty: "Warranty",
};

const GROUP_DOT: Record<string, string> = {
  order: "#e08585",
  hardware: "#e8b56a",
  sample: "#5a8db8",
  custom: "#b8a05a",
  warranty: "#8fbe70",
};

type Scope = "mine" | "unclaimed" | "team" | "all";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "mine", label: "My work" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "team", label: "Team" },
  { key: "all", label: "All" },
];

/** Which reasons a filter chip offers. `null` means every reason. */
const REASON_FILTERS: { key: AttentionKind | null; label: string }[] = [
  { key: null, label: "Everything" },
  { key: "sla_breached", label: "Past SLA" },
  { key: "blocked_missing_data", label: "Blocked" },
  { key: "sla_due_soon", label: "Due soon" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "payment_hold", label: "Payment hold" },
];

export function WorkClient({ initialScope = "mine" }: { initialScope?: Scope }) {
  const { allOrders, team } = useStore();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [scope, setScope] = useState<Scope>(initialScope);
  const [reason, setReason] = useState<AttentionKind | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);

  const rows = useMemo(() => {
    const out: { order: Order; reasons: AttentionReason[] }[] = [];
    for (const o of allOrders) {
      if (o.archived) continue;

      // Scope first -- cheaper than deriving reasons for rows we will drop.
      if (scope === "mine" && o.claimed_by !== currentUserId) continue;
      if (scope === "unclaimed" && o.claimed_by) continue;
      if (scope === "team" && (!o.claimed_by || o.claimed_by === currentUserId)) continue;

      const reasons = attentionFor(o);
      if (reasons.length === 0) continue;
      if (reason && !reasons.some((r) => r.kind === reason)) continue;
      out.push({ order: o, reasons });
    }
    // High severity first, then oldest. A breach outranks a warning, and among
    // equals the one that has waited longest goes on top.
    return out.sort((a, b) => {
      const sev = (x: typeof a) => (x.reasons.some((r) => r.severity === "high") ? 0 : 1);
      if (sev(a) !== sev(b)) return sev(a) - sev(b);
      return String(a.order.stage_entered_at ?? "").localeCompare(
        String(b.order.stage_entered_at ?? ""));
    });
  }, [allOrders, scope, reason, currentUserId]);

  // Counts per scope, so the tabs say how much is behind them without a click.
  const scopeCounts = useMemo(() => {
    const c: Record<Scope, number> = { mine: 0, unclaimed: 0, team: 0, all: 0 };
    for (const o of allOrders) {
      if (o.archived || attentionFor(o).length === 0) continue;
      c.all++;
      if (o.claimed_by === currentUserId && currentUserId) c.mine++;
      else if (!o.claimed_by) c.unclaimed++;
      else c.team++;
    }
    return c;
  }, [allOrders, currentUserId]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Needs someone"
        title="Work"
        accent="queue"
      />

      <div className="px-6 lg:px-8 pb-12">
        {/* Scope */}
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

        {/* Reason */}
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
                : "No orders match this filter."}
            </p>
          </div>
        ) : (
          <div
            className="rounded-panel overflow-hidden"
            style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}
          >
            {/* Column order IS the hierarchy: why → what → where → who → next. */}
            <div
              className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.8fr_0.7fr] gap-3 px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span>Issue</span>
              <span>Order</span>
              <span>Type</span>
              <span>Stage</span>
              <span>Owner</span>
            </div>

            {rows.map(({ order, reasons }) => {
              // An UNCLAIMED row leads with that, whatever else is wrong.
              //
              // "Past SLA · 5d in stage" on a row nobody owns tells you it is
              // late; "Unclaimed · 5d" tells you why it is late and what to do.
              // Severity alone put the breach first, which is true and less
              // useful -- the breach is a consequence of the thing below it.
              const unclaimedReason = reasons.find((r) => r.kind === "unclaimed");
              const lead = (!order.claimed_by && unclaimedReason)
                ? unclaimedReason
                : reasons.find((r) => r.severity === "high") ?? reasons[0];
              const owner = order.claimed_by
                ? team.find((m) => m.id === order.claimed_by)
                : undefined;
              const accent = STAGE_ACCENT[order.stage] ?? "#8a8a8a";
              return (
                <button
                  key={order.id}
                  onClick={() => setSelected(order)}
                  className="w-full grid grid-cols-[1.6fr_0.9fr_0.7fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-left transition-colors hover:bg-white/4"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: lead.severity === "high" ? "#e08585" : "#e8b56a" }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[12px] text-cream/90 truncate">{lead.label}</span>
                      {lead.detail && (
                        <span className="block text-[10px] text-cream/40 truncate">{lead.detail}</span>
                      )}
                      {/* A row can want you for several reasons at once. The
                          lead is the most urgent; the rest are worth knowing
                          before you open it. */}
                      {reasons.length > 1 && (
                        <span className="block text-[9px] text-cream/30 truncate">
                          +{reasons.length - 1} more
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="text-[11px] font-mono text-cream/65 truncate self-center">
                    {displayOrderNumber(order)}
                  </span>

                  {/* The TYPE, not the customer. This column was labelled Type
                      and populated with order.name -- so the queue showed the
                      customer under the wrong heading and the type nowhere,
                      which is the exact hierarchy inversion this page exists to
                      fix. The customer is one click away in the modal; which
                      pipeline a row belongs to is what decides whether you can
                      act on it. */}
                  <span className="self-center flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: GROUP_DOT[order.type] ?? "#8a8a8a" }} />
                    <span className="text-[11px] text-cream/60 truncate">
                      {GROUP_LABEL[order.type] ?? order.type}
                    </span>
                  </span>

                  <span className="self-center">
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        color: accent,
                        border: `0.5px solid ${accent}55`,
                      }}
                    >
                      {order.stage}
                    </span>
                  </span>

                  <span className="self-center flex items-center gap-1.5 min-w-0">
                    {owner ? (
                      <>
                        <AvatarWithProfile member={owner} size="sm" />
                        <span className="text-[10px] text-cream/50 truncate">{owner.name}</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-cream/30 italic">unclaimed</span>
                    )}
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
          /* Close on a stage change. The row was in this queue for a reason,
             and moving it forward usually resolves that reason -- leaving the
             modal open over a queue the row has just left is confusing. The
             store updates through Realtime either way, so the list behind is
             already correct. */
          onStageChange={() => setSelected(null)}
        />
      )}
    </AppShell>
  );
}
