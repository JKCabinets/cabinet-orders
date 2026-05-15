"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import { Order, OrderStage, AVATAR_COLOR_STYLES, Stage } from "@/lib/data";
import { SLA_TARGETS, daysInStage, isOverdue } from "@/lib/sla";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AlertTriangle, ArrowRight, Archive } from "lucide-react";
import clsx from "clsx";

// Stages with an SLA target. Delivered/Resolved have target Infinity
// so they never appear here.
const TRACKED_STAGES: OrderStage[] = ["New", "Entered", "In production", "At cross dock"];

// Softened brand colors per stage (match the rest of the app)
const STAGE_COLOR: Record<string, string> = {
  "New":              "#c97070",
  "Entered":          "#d4922a",
  "In production":    "#c8b84a",
  "At cross dock":    "#5a8db8",
  "Delivered":        "#8fbe70",
};

// Determine what the most-likely next action is for an overdue order.
// In New → claim it. In any later stage → move to next stage.
// (Archive is always available as a secondary action.)
const NEXT_STAGE: Partial<Record<OrderStage, OrderStage>> = {
  "New":              "Entered",
  "Entered":          "In production",
  "In production":    "At cross dock",
  "At cross dock":    "Delivered",
};

export function SLAClient() {
  const { orders, team, claimOrder, moveStage, archiveOrder } = useStore();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name ?? null;

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Active (non-archived, non-warranty) orders only
  const active = useMemo(() => orders.filter(o => !o.archived), [orders]);

  // Overdue orders grouped by stage. Each group sorted by days descending
  // so the worst offenders are at the top.
  const overdueByStage = useMemo(() => {
    const result: Record<OrderStage, Order[]> = {
      "New": [], "Entered": [], "In production": [], "At cross dock": [], "Delivered": [],
    };
    for (const o of active) {
      if (isOverdue(o)) {
        const stage = o.stage as OrderStage;
        if (stage in result) result[stage].push(o);
      }
    }
    for (const stage of TRACKED_STAGES) {
      result[stage].sort((a, b) => (daysInStage(b) ?? 0) - (daysInStage(a) ?? 0));
    }
    return result;
  }, [active]);

  const totalOverdue = TRACKED_STAGES.reduce((sum, s) => sum + overdueByStage[s].length, 0);

  // ─── Trends ───────────────────────────────────────────────────────
  // For each tracked stage, compute the average days in stage across
  // ALL orders currently in that stage (overdue or not). This gives
  // a "how is each step pacing right now" snapshot.
  const trendsByStage = useMemo(() => {
    return TRACKED_STAGES.map(stage => {
      const inStage = active.filter(o => o.stage === stage);
      const ages = inStage.map(o => daysInStage(o)).filter((d): d is number => d !== null);
      const avg = ages.length === 0 ? 0 : ages.reduce((s, d) => s + d, 0) / ages.length;
      const target = SLA_TARGETS[stage];
      const overdueCount = inStage.filter(o => isOverdue(o)).length;
      const overdueRatio = inStage.length === 0 ? 0 : overdueCount / inStage.length;
      return {
        stage,
        count: inStage.length,
        avgDays: Math.round(avg * 10) / 10,
        target,
        overdueCount,
        overdueRatio,
      };
    });
  }, [active]);

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

        {/* ── Trends ──────────────────────────────────────────────── */}
        <div className="glass-sage rounded-panel p-5 lg:p-6">
          <div className="mb-4">
            <div className="eyebrow mb-1">Stage health</div>
            <h2 className="font-display text-[22px] text-cream">
              Pacing <em className="italic-storm">right now</em>
            </h2>
            <p className="text-[12px] text-cream/55 mt-1">
              Average days in each stage across all active orders, and the share that are past target.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-cream/45 mb-3">Average days in stage</div>
              <div className="space-y-3">
                {trendsByStage.map(t => (
                  <BarRow
                    key={t.stage}
                    label={t.stage}
                    value={t.avgDays}
                    max={Math.max(...trendsByStage.map(x => Math.max(x.avgDays, x.target * 1.5)))}
                    target={t.target}
                    valueLabel={`${t.avgDays}d`}
                    targetLabel={`tgt ${t.target}d`}
                    color={STAGE_COLOR[t.stage]}
                    pastTarget={t.avgDays > t.target}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.13em] text-cream/45 mb-3">Share of orders past target</div>
              <div className="space-y-3">
                {trendsByStage.map(t => (
                  <BarRow
                    key={t.stage}
                    label={t.stage}
                    value={t.overdueRatio * 100}
                    max={100}
                    valueLabel={`${Math.round(t.overdueRatio * 100)}%`}
                    secondaryLabel={`${t.overdueCount}/${t.count}`}
                    color={STAGE_COLOR[t.stage]}
                    pastTarget={t.overdueRatio > 0}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Operational: overdue orders by stage ────────────────── */}
        {totalOverdue > 0 && (
          <div className="space-y-4">
            {TRACKED_STAGES.map(stage => {
              const orders = overdueByStage[stage];
              if (orders.length === 0) return null;
              return (
                <OverdueStageBlock
                  key={stage}
                  stage={stage}
                  orders={orders}
                  team={team}
                  currentUserName={currentUserName}
                  onOpenOrder={setSelectedOrder}
                  onClaim={(id) => claimOrder(id, currentUserName)}
                  onAdvance={(id, target) => moveStage(id, target as Stage, currentUserName ?? undefined)}
                  onArchive={(id) => archiveOrder(id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          tab="orders"
          onClose={() => setSelectedOrder(null)}
          onStageChange={(s) => setSelectedOrder(prev => prev ? { ...prev, stage: s } : null)}
        />
      )}
    </AppShell>
  );
}

/* ─── Overdue stage block ───────────────────────────────────────────── */

function OverdueStageBlock({
  stage, orders, team, currentUserName, onOpenOrder,
  onClaim, onAdvance, onArchive,
}: {
  stage: OrderStage;
  orders: Order[];
  team: Array<{ name: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserName: string | null;
  onOpenOrder: (o: Order) => void;
  onClaim: (id: string) => Promise<unknown>;
  onAdvance: (id: string, target: OrderStage) => Promise<unknown>;
  onArchive: (id: string) => Promise<unknown>;
}) {
  const color = STAGE_COLOR[stage] ?? "#a0a09a";
  const target = SLA_TARGETS[stage];
  const next = NEXT_STAGE[stage];

  return (
    <div className="glass-sage rounded-panel overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10">
        <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
        <h3 className="font-display text-[17px] text-cream">
          {stage}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-cream/45 ml-auto">
          target {isFinite(target) ? `${target}d` : "—"} · {orders.length} overdue
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {orders.map(o => (
          <OverdueRow
            key={o.id}
            order={o}
            team={team}
            currentUserName={currentUserName}
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
  order, team, currentUserName, color, nextStage,
  onOpen, onClaim, onAdvance, onArchive,
}: {
  order: Order;
  team: Array<{ name: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserName: string | null;
  color: string;
  nextStage?: OrderStage;
  onOpen: () => void;
  onClaim: () => Promise<unknown>;
  onAdvance?: () => Promise<unknown>;
  onArchive: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const days = daysInStage(order);
  const target = SLA_TARGETS[order.stage as OrderStage];
  const daysOver = days !== null && isFinite(target) ? days - target : null;

  // Stage-aware owner (matches the rest of the app)
  const isNew = order.stage === "New";
  const ownerName = isNew ? order.claimed_by ?? null : order.entered_by ?? order.claimed_by ?? null;
  const ownerMember = ownerName ? team.find(m => m.name === ownerName) : null;
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
          background: "rgba(232,144,144,0.12)",
          border: "0.5px solid rgba(232,144,144,0.35)",
          minWidth: 52,
        }}
        title={`${days}d in stage, target ${target}d`}
      >
        <span className="font-display text-[18px] leading-none" style={{ color: "#e89090" }}>+{daysOver}</span>
        <span className="text-[8px] uppercase tracking-wider text-cream/55 mt-0.5">days over</span>
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
        {isNew && order.claimed_by === currentUserName && onAdvance && (
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
            const msg = pastFinish
              ? `Move "${order.name}" to At cross dock now?`
              : finish
              ? `Production isn't scheduled to finish until ${finish}.\n\nPush "${order.name}" to At cross dock anyway?`
              : `No estimated finish date set.\n\nPush "${order.name}" to At cross dock now?`;
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
