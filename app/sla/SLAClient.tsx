"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  Order, OrderStage, OrderType, AVATAR_COLOR_STYLES, Stage,
  STAGE_ACCENT, STAGE_LIST_BY_TYPE, nextStageFor,
} from "@/lib/data";
import {
  SLA_RULES, slaTier, slaRuleFor, hoursInStage, slaAgeHours, formatStageAge,
} from "@/lib/sla";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AlertTriangle, ArrowRight, Archive } from "lucide-react";
import clsx from "clsx";

// Tracked stages are DERIVED per type: the stages of that type's own flow
// that carry a rule in SLA_RULES. There is no hardcoded list here any more,
// so adding a stage or a type grows this page without editing it.
//
// Stage colours come from lib/data's STAGE_ACCENT rather than a private
// copy, and the next stage from nextStageFor rather than a hardcoded map
// that only knew the standard order flow.
const CATEGORIES: { key: OrderType; label: string }[] = [
  { key: "order",    label: "Standard orders" },
  { key: "custom",   label: "Custom orders" },
  { key: "sample",   label: "Sample orders" },
  { key: "warranty", label: "Warranty claims" },
];

export function SLAClient() {
  const {
    orders, customs, samples, warranties,
    team, claimOrder, moveStage, archiveOrder,
  } = useStore();
  const { data: session } = useSession();
  // See OrderTable for the full story. We standardize on team_members.id
  // (post-v18 migration) for ALL ownership comparisons — immutable,
  // survives renames. Render display name via team.find(m => m.id === ...).
  const sessUser = session?.user as { id?: string; name?: string; username?: string } | undefined;
  const currentUserId = sessUser?.id ?? null;

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // ─── Per-category rollup ──────────────────────────────────────────
  // Each order type is its own category with its own stages, rules and
  // overdue list. Stages come from the intersection of the type's flow
  // (STAGE_LIST_BY_TYPE) and the stages that actually carry a rule, so a
  // stage with no SLA -- Delivered, or warranty's Parts ordered -- is simply
  // absent rather than special-cased.
  const categories = useMemo(() => {
    const now = Date.now();
    const lists: Record<OrderType, Order[]> = {
      order: orders, custom: customs, sample: samples, warranty: warranties,
    };
    return CATEGORIES.map(({ key, label }) => {
      const rows = (lists[key] ?? []).filter(o => !o.archived);
      const rules = SLA_RULES[key] ?? {};
      const stages = (STAGE_LIST_BY_TYPE[key] ?? []).filter(s => rules[s]);

      const overdueByStage: Record<string, Order[]> = {};
      for (const s of stages) overdueByStage[s] = [];
      let totalFlagged = 0;
      for (const o of rows) {
        if (slaTier(o, now) === "ok") continue;
        if (!overdueByStage[o.stage]) continue;
        overdueByStage[o.stage].push(o);
        totalFlagged++;
      }
      // Worst offenders first.
      for (const s of stages) {
        overdueByStage[s].sort(
          (a, b) => (hoursInStage(b, now) ?? 0) - (hoursInStage(a, now) ?? 0));
      }

      const trends = stages.map(stage => {
        const inStage = rows.filter(o => o.stage === stage);
        const rule = rules[stage];
        const soft = rule?.softHours ?? 24;
        const hard = rule?.hardHours ?? 48;

        // Only rows whose clock is RUNNING get bucketed. In production and
        // At cross dock stop their clock once the awaited dates exist, so
        // bucketing everything would report "3 over 48h" beside "0 past
        // target". `count` stays the true population of the stage.
        const measured = inStage.filter(o => !rule?.clockRuns || rule.clockRuns(o));

        // Aged on each row's OWN clock: New runs on the order date, so a
        // bounced order shows its real age rather than a reset stage clock.
        const ages = measured
          .map(o => (rule ? slaAgeHours(o, rule, now) : hoursInStage(o, now)))
          .filter((h): h is number => h !== null);

        const buckets = {
          fresh: ages.filter(h => h < soft).length,
          warn: ages.filter(h => h >= soft && h < hard).length,
          over: ages.filter(h => h >= hard).length,
        };
        const oldestHours = ages.length === 0 ? null : Math.max(...ages);
        const flaggedCount = inStage.filter(o => slaTier(o, now) !== "ok").length;

        return {
          stage,
          count: inStage.length,
          measuredCount: measured.length,
          buckets,
          oldestHours,
          softHours: soft,
          hardHours: hard,
          waitingFor: rule?.waitingFor,
          measuresFrom: rule?.measureFrom === "created" ? "created" : "stage",
          flaggedCount,
        };
      });

      return { key, label, rows, stages, trends, overdueByStage, totalFlagged };
    });
  }, [orders, customs, samples, warranties]);

  const totalOverdue = categories.reduce((sum, c) => sum + c.totalFlagged, 0);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Service levels"
        title="SLA"
        accent="deep dive"
      />

      <div className="px-6 lg:px-8 pb-12 space-y-6">

        {/* ── Headline summary card ───────────────────────────────── */}
        <div className="glass-sage rounded-panel p-5 lg:p-6">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="font-display text-[32px] leading-none"
              style={{ color: totalOverdue > 0 ? "#e89090" : "#a0cc7a" }}
            >
              {totalOverdue}
            </span>
            <span className="text-cream/70">
              order{totalOverdue === 1 ? "" : "s"} past their <em className="italic-storm">SLA target</em>
            </span>
            {totalOverdue === 0 && (
              <span className="text-[12px] uppercase tracking-wider text-cream/45 ml-2">— all clear</span>
            )}
          </div>
          {totalOverdue > 0 && (
            <p className="text-[12px] text-cream/55 mt-2 leading-relaxed">
              Scroll down for the full list — every order past its target with a recommended next action.
            </p>
          )}
        </div>

        {/* ── One section per order type ──────────────────────────── */}
        {categories.map(cat => {
          if (cat.rows.length === 0) return null;
          return (
            <div key={cat.key} className="space-y-4">
              <div className="glass-sage rounded-panel p-5 lg:p-6">
                <div className="mb-4">
                  <div className="eyebrow mb-1">Stage health</div>
                  <h2 className="font-display text-[22px] text-cream">
                    {cat.label}
                  </h2>
                  <p className="text-[12px] text-cream/55 mt-1">
                    {cat.rows.length} active
                    {cat.totalFlagged > 0
                      ? ` · ${cat.totalFlagged} past target`
                      : " · all on track"}
                  </p>
                </div>

                {cat.trends.length === 0 ? (
                  <p className="text-[12px] text-cream/45">No stages in this flow carry an SLA.</p>
                ) : (
                  <div className="space-y-4">
                    {cat.trends.map(t => (
                      <StageAgingRow key={t.stage} trend={t} />
                    ))}
                  </div>
                )}
              </div>

              {cat.stages.map(stage => {
                const flagged = cat.overdueByStage[stage];
                if (!flagged || flagged.length === 0) return null;
                return (
                  <OverdueStageBlock
                    key={`${cat.key}-${stage}`}
                    stage={stage}
                    orders={flagged}
                    team={team}
                    currentUserId={currentUserId}
                    onOpenOrder={setSelectedOrder}
                    onClaim={(id) => claimOrder(id, currentUserId)}
                    onAdvance={(id, target) => moveStage(id, target as Stage, currentUserId ?? undefined)}
                    onArchive={(id) => archiveOrder(id)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStageChange={(s) => setSelectedOrder(prev => prev ? { ...prev, stage: s } : null)}
        />
      )}
    </AppShell>
  );
}

/* ─── Stage aging ───────────────────────────────────────────────────── */

/**
 * One stage's queue, as a shape rather than an average.
 *
 * A segmented bar splits the rows whose clock is running into under-soft,
 * soft-to-hard and over-hard, and the oldest is called out separately because
 * that is the row you act on. An average across one or two orders told you
 * nothing an individual row did not.
 */
function StageAgingRow({ trend }: {
  trend: {
    stage: string;
    count: number;
    measuredCount: number;
    buckets: { fresh: number; warn: number; over: number };
    oldestHours: number | null;
    softHours: number;
    hardHours: number;
    waitingFor?: string;
    measuresFrom: string;
    flaggedCount: number;
  };
}) {
  const t = trend;
  const total = Math.max(1, t.measuredCount);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const color = STAGE_ACCENT[t.stage] ?? "#a0a09a";
  const ageWord = t.measuresFrom === "created" ? "old" : "in stage";

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[12px] text-cream/85">{t.stage}</span>
        {t.waitingFor && (
          <span className="text-[10px] text-cream/40">awaiting {t.waitingFor}</span>
        )}
        <span className="text-[10px] text-cream/40 ml-auto">
          {t.count} in stage
          {t.measuredCount !== t.count && ` · ${t.measuredCount} on the clock`}
        </span>
        <span
          className="text-[11px] font-mono"
          style={{ color: t.flaggedCount > 0 ? "#e89090" : "rgba(232,227,218,0.45)" }}
        >
          {t.oldestHours === null
            ? "—"
            : `oldest ${formatStageAge(t.oldestHours)} ${ageWord}`}
        </span>
      </div>

      {t.measuredCount === 0 ? (
        <div className="h-1.5 rounded-full bg-white/6" />
      ) : (
        <div className="h-1.5 rounded-full overflow-hidden flex bg-white/6">
          {t.buckets.fresh > 0 && (
            <div style={{ width: pct(t.buckets.fresh), background: "rgba(143,190,112,0.55)" }} />
          )}
          {t.buckets.warn > 0 && (
            <div style={{ width: pct(t.buckets.warn), background: "#d4922a" }} />
          )}
          {t.buckets.over > 0 && (
            <div style={{ width: pct(t.buckets.over), background: "#e89090" }} />
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-1 text-[10px]">
        <span className="text-cream/40">{t.buckets.fresh} under {t.softHours}h</span>
        <span style={{ color: t.buckets.warn > 0 ? "#d4922a" : "rgba(232,227,218,0.30)" }}>
          {t.buckets.warn} over {t.softHours}h
        </span>
        <span style={{ color: t.buckets.over > 0 ? "#e89090" : "rgba(232,227,218,0.30)" }}>
          {t.buckets.over} over {t.hardHours}h
        </span>
      </div>
    </div>
  );
}

/* ─── Overdue stage block ───────────────────────────────────────────── */

function OverdueStageBlock({
  stage, orders, team, currentUserId, onOpenOrder,
  onClaim, onAdvance, onArchive,
}: {
  // `string`, not OrderStage: this block now renders warranty and custom
  // stages too, which are not members of OrderStage.
  stage: string;
  orders: Order[];
  team: Array<{ id: string; name: string; username: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserId: string | null;
  onOpenOrder: (o: Order) => void;
  onClaim: (id: string) => Promise<unknown>;
  onAdvance: (id: string, target: Stage) => Promise<unknown>;
  onArchive: (id: string) => Promise<unknown>;
}) {
  const color = STAGE_ACCENT[stage] ?? "#a0a09a";
  // Rule and next stage both come from the FIRST row, because a block only
  // ever holds rows of one type at one stage.
  const rule = orders.length > 0 ? slaRuleFor(orders[0]) : undefined;
  const next = orders.length > 0 ? nextStageFor(orders[0]) : undefined;

  return (
    <div className="glass-sage rounded-panel overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10">
        <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
        <h3 className="font-display text-[17px] text-cream">
          {stage}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-cream/45 ml-auto">
          {rule ? `${rule.softHours}h / ${rule.hardHours}h` : "—"}
          {rule?.waitingFor ? ` awaiting ${rule.waitingFor}` : ""}
          {` · ${orders.length} past target`}
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {orders.map(o => (
          <OverdueRow
            key={o.id}
            order={o}
            team={team}
            currentUserId={currentUserId}
            color={color}
            nextStage={next}
            onOpen={() => onOpenOrder(o)}
            onClaim={() => onClaim(o.id)}
            onAdvance={next ? () => onAdvance(o.id, next) : undefined}
            onArchive={() => onArchive(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OverdueRow({
  order, team, currentUserId, color, nextStage,
  onOpen, onClaim, onAdvance, onArchive,
}: {
  order: Order;
  team: Array<{ id: string; name: string; username: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserId: string | null;
  color: string;
  nextStage?: Stage;
  onOpen: () => void;
  onClaim: () => Promise<unknown>;
  onAdvance?: () => Promise<unknown>;
  onArchive: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const hours = hoursInStage(order);
  const tier = slaTier(order);
  const rule = slaRuleFor(order);
  // Terracotta past the hard threshold, amber past the soft one.
  const tierColor = tier === "hard" ? "#e89090" : "#d4922a";

  // Stage-aware owner (matches the rest of the app)
  const isNew = order.stage === "New";
  const ownerName = isNew ? order.claimed_by ?? null : order.entered_by ?? order.claimed_by ?? null;
  // ownerName is now a team_members.id (post-v18 migration); lookup by id.
  const ownerMember = ownerName ? team.find(m => m.id === ownerName) : null;
  const ownerInitials = ownerMember?.initials ?? (ownerName ? ownerName.slice(0, 2).toUpperCase() : "");
  const ownerStyle = ownerMember
    ? AVATAR_COLOR_STYLES[ownerMember.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-white/4 transition-colors">
      {/* Days-over badge */}
      <div
        className="flex flex-col items-center justify-center rounded-brand px-2.5 py-1.5 flex-shrink-0"
        style={{
          background: `${tierColor}1f`,
          border: `0.5px solid ${tierColor}59`,
          minWidth: 52,
        }}
        title={
          rule
            ? `${formatStageAge(hours)} in stage · warn ${rule.softHours}h · act ${rule.hardHours}h`
            : `${formatStageAge(hours)} in stage`
        }
      >
        <span className="font-display text-[18px] leading-none" style={{ color: tierColor }}>
          {formatStageAge(hours)}
        </span>
        <span className="text-[8px] uppercase tracking-wider text-cream/55 mt-0.5">
          {tier === "hard" ? "act now" : "in stage"}
        </span>
      </div>

      {/* Order body */}
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[10px] text-cream/45">{order.id}</span>
          {order.source === "Shopify" && (
            <span className="text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full"
              style={{ background: "rgba(184,130,106,0.15)", color: "#d9a888", border: "0.5px solid rgba(184,130,106,0.40)" }}>
              Shopify
            </span>
          )}
          {order.source === "Manual" && (
            <span className="text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full"
              style={{ background: "rgba(145,165,151,0.18)", color: "#b8d0bd", border: "0.5px solid rgba(145,165,151,0.45)" }}>
              Custom
            </span>
          )}
        </div>
        <div className="font-display text-[15px] text-cream truncate">{order.name}</div>
      </button>

      {/* Owner */}
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0 mr-2" title={ownerName ?? "unclaimed"}>
        {ownerName ? (
          <>
            <div style={{ ...ownerStyle, borderWidth: 1, borderStyle: "solid" }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold">
              {ownerInitials}
            </div>
            <span className="text-[11px] text-cream/55 hidden lg:inline truncate max-w-[120px]">{ownerName}</span>
          </>
        ) : (
          <span className="text-[10px] text-cream/30 italic">unclaimed</span>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* New + unclaimed → Claim */}
        {isNew && !order.claimed_by && (
          <button
            onClick={() => withBusy(onClaim)}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
          >
            {busy ? "…" : "Claim"}
          </button>
        )}
        {/* New + claimed by me → Mark Entered (the attachment gate still applies; modal handles it) */}
        {isNew && order.claimed_by === currentUserId && onAdvance && (
          <button
            onClick={() => withBusy(onAdvance)}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
            title="Requires an attached PDF"
          >
            {busy ? "…" : <>Mark Entered <ArrowRight className="w-3 h-3" /></>}
          </button>
        )}
        {/* Entered → either show prompt to set start date (which auto-advances) or open modal */}
        {order.stage === "Entered" && (
          order.production_start_date ? (
            // Date is set but somehow still in Entered (e.g. stale state) — open modal
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
            >
              Open
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
              title="Set production start date — order auto-advances once set"
            >
              Set start date →
            </button>
          )
        )}
        {/* In production → Early Push (with soft confirm) or normal advance if past est finish */}
        {order.stage === "In production" && onAdvance && (() => {
          const advance = onAdvance;
          const finish = order.production_est_finish_date;
          const todayIso = new Date().toISOString().slice(0, 10);
          const pastFinish = finish && finish <= todayIso;
          function go() {
            const displayName = order.name;
            const msg = pastFinish
              ? `Move "${displayName}" to At cross dock now?`
              : finish
              ? `Production isn't scheduled to finish until ${finish}.\n\nPush "${displayName}" to At cross dock anyway?`
              : `No estimated finish date set.\n\nPush "${displayName}" to At cross dock now?`;
            if (typeof window !== "undefined" && !window.confirm(msg)) return Promise.resolve();
            return advance();
          }
          return (
            <button
              onClick={() => withBusy(go)}
              disabled={busy}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all border",
                pastFinish
                  ? "bg-terracotta/20 border-terracotta/45 text-terracotta hover:bg-terracotta/30"
                  : "bg-white/6 border-cream/15 text-cream/85 hover:bg-white/10"
              )}
            >
              {busy ? "…" : pastFinish ? <>Cross dock <ArrowRight className="w-3 h-3" /></> : "Early Push"}
            </button>
          );
        })()}
        {/* At cross dock → Confirm Delivery only when delivery date is set */}
        {order.stage === "At cross dock" && onAdvance && (
          order.scheduled_delivery_date ? (
            <button
              onClick={() => withBusy(onAdvance)}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
            >
              {busy ? "…" : <>Confirm Delivery <ArrowRight className="w-3 h-3" /></>}
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
              title="Open order to set delivery date"
            >
              Set delivery date →
            </button>
          )
        )}

        {/* Archive (secondary) */}
        <button
          onClick={() => withBusy(onArchive)}
          disabled={busy}
          className="p-1.5 rounded-full transition-colors hover:bg-white/10 text-cream/45 hover:text-cream/85 disabled:opacity-50"
          title="Archive"
          aria-label="Archive"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Bar row (trends section) ─────────────────────────────────────── */

function BarRow({
  label, value, max, target, valueLabel, secondaryLabel, targetLabel, color, pastTarget,
}: {
  label: string;
  value: number;
  max: number;
  target?: number;
  valueLabel: string;
  secondaryLabel?: string;
  targetLabel?: string;
  color: string;
  pastTarget: boolean;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const targetPct = target !== undefined && max > 0 ? Math.min(100, (target / max) * 100) : null;
  const barColor = pastTarget ? "#e89090" : color;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[12px] text-cream/75">{label}</span>
        <div className="flex items-baseline gap-2">
          {targetLabel && <span className="text-[9px] text-cream/35 font-mono">{targetLabel}</span>}
          {secondaryLabel && <span className="text-[9px] text-cream/40">{secondaryLabel}</span>}
          <span
            className={clsx("text-[12px] font-medium tabular-nums")}
            style={{ color: pastTarget ? "#e89090" : "#e8e3da" }}
          >
            {valueLabel}
          </span>
        </div>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden relative"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
        {targetPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${targetPct}%`, background: "rgba(255,255,255,0.35)" }}
            title={`target ${target}d`}
          />
        )}
      </div>
    </div>
  );
}
