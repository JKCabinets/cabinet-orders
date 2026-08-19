"use client";

/**
 * SLA health, one row per order type.
 *
 * SHARED BY /sla AND THE DASHBOARD, deliberately.
 *
 * The dashboard previously carried its own smaller version of this. Two
 * renderings of the same numbers is exactly the pattern that produced four
 * competing definitions of "overdue" and seven copies of the stage colour map
 * -- they agree until one is edited. There is one component and two consumers.
 *
 * The two pages differ only in whether the rows are interactive: /sla passes
 * onSelectType so a row drives the stage breakdown below it, the dashboard
 * passes href so a row navigates. Neither forks the markup.
 */

import { ChevronDown } from "lucide-react";
import { formatStageAge } from "@/lib/sla";

export interface SlaTypeRow {
  key: string;
  label: string;
  /** Active (non-archived) rows of this type. */
  active: number;
  /** Rows whose clock is running and still inside the soft threshold. */
  onTrack: number;
  /** Past soft, not yet past hard. */
  overSoft: number;
  /** Past hard. */
  overHard: number;
  /**
   * Age of the oldest row with a running clock, in hours, and where that
   * clock is measured from -- "created" renders as "old", the stage clock as
   * plain elapsed time. New measures from the order date, so calling it
   * "in stage" would be wrong.
   */
  oldestHours: number | null;
  oldestFrom: "created" | "stage";
}

export function SlaHealthByType({
  rows,
  selectedKey,
  onSelectType,
  compact = false,
}: {
  rows: SlaTypeRow[];
  /** Highlighted row, when the parent is using this as a selector. */
  selectedKey?: string;
  /** Omit to render read-only (the dashboard). */
  onSelectType?: (key: string) => void;
  /** Drops the header row and tightens spacing, for the dashboard. */
  compact?: boolean;
}) {
  const visible = rows.filter(r => r.active > 0);
  if (visible.length === 0) {
    return (
      <p className="text-[12px] text-cream/45">No active orders of any type.</p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse min-w-[560px]">
        {!compact && (
          <thead>
            <tr className="border-b" style={{ borderColor: "rgba(232,227,218,0.10)" }}>
              <Th className="text-left">Order type</Th>
              <Th>Active</Th>
              <Th><Dot color="#a0cc7a" /> On track</Th>
              <Th><Dot color="#d4922a" /> &gt; 24h</Th>
              <Th><Dot color="#e89090" /> &gt; 48h</Th>
              <Th className="text-right">Oldest</Th>
              {onSelectType && <Th className="w-8" />}
            </tr>
          </thead>
        )}
        <tbody>
          {visible.map(r => {
            const selected = selectedKey === r.key;
            const worst = r.overHard > 0 ? "#e89090" : r.overSoft > 0 ? "#d4922a" : null;
            return (
              <tr
                key={r.key}
                onClick={onSelectType ? () => onSelectType(r.key) : undefined}
                className={[
                  "border-b transition-colors",
                  onSelectType ? "cursor-pointer hover:bg-white/[0.03]" : "",
                ].join(" ")}
                style={{
                  borderColor: "rgba(232,227,218,0.06)",
                  background: selected ? "rgba(255,255,255,0.035)" : undefined,
                }}
              >
                <td className={`${compact ? "py-2" : "py-3"} pr-3 text-[12px] text-cream/85`}>
                  {r.label}
                </td>
                <Td>{r.active}</Td>
                <Td color={r.onTrack > 0 ? "#a0cc7a" : "rgba(232,227,218,0.30)"}>{r.onTrack}</Td>
                <Td color={r.overSoft > 0 ? "#d4922a" : "rgba(232,227,218,0.30)"}>{r.overSoft}</Td>
                <Td color={r.overHard > 0 ? "#e89090" : "rgba(232,227,218,0.30)"}>{r.overHard}</Td>
                <td className={`${compact ? "py-2" : "py-3"} pl-3 text-right`}>
                  {r.oldestHours === null ? (
                    <span className="text-[11px] text-cream/30">—</span>
                  ) : (
                    <span
                      className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
                      style={
                        worst
                          ? { background: `${worst}22`, color: worst, border: `0.5px solid ${worst}55` }
                          : { background: "rgba(255,255,255,0.05)", color: "rgba(232,227,218,0.65)", border: "0.5px solid rgba(232,227,218,0.14)" }
                      }
                      title={r.oldestFrom === "created"
                        ? "Measured from the order date — this stage does not use the stage clock"
                        : "Time in the current stage"}
                    >
                      {formatStageAge(r.oldestHours)}{r.oldestFrom === "created" ? " old" : ""}
                    </span>
                  )}
                </td>
                {onSelectType && (
                  <td className="py-3 pl-2 text-right">
                    <ChevronDown
                      className="w-3.5 h-3.5 inline-block transition-transform"
                      style={{
                        color: selected ? "rgba(232,227,218,0.85)" : "rgba(232,227,218,0.35)",
                        transform: selected ? "rotate(180deg)" : undefined,
                      }}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`py-2 px-2 text-[10px] uppercase tracking-wider font-medium text-cream/40 whitespace-nowrap ${className || "text-center"}`}>
      {children}
    </th>
  );
}

function Td({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <td className="py-3 px-2 text-center text-[12px] font-mono" style={{ color: color ?? "rgba(232,227,218,0.85)" }}>
      {children}
    </td>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
      style={{ background: color }}
    />
  );
}
