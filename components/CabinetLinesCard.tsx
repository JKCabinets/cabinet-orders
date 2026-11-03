"use client";

/**
 * PRODUCTION & DELIVERY FOR A CABINET ORDER, A ROW PER LINE (2026-11-03,
 * feature 10; Garrett: "two columns, Production and Delivery. Then below
 * should only list the lines included in the order … the production date
 * ranges (start and finish) and the delivery date in the next column. When
 * modifying it should group them … first Production dates with the cabinet
 * lines below, the next Delivery dates").
 *
 * The lines are lib/shipDates' (the one vendor rule). Each line's dates are its
 * own on a mixed order (orders.vendor_start_dates, vendor_ship_dates,
 * vendor_delivery_targets), else the order's. A line marked shipped in Shopify
 * shows so in place of its ship date, and its date is re-sent unchanged -- the
 * server refuses any change (feature 9). Samples, hardware, custom jobs and
 * claims keep OrderModal's StageInputsCard.
 */
import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { formatMDY } from "@/lib/dates";
import { cabinetVendorsOf, vendorShipDate, shippedOnText } from "@/lib/shipDates";
import type { Order } from "@/lib/data";
import type { DateFields } from "./NextActionPanel";

type Field = "start" | "ship" | "target";
const ORDER_FIELD = { start: "production_start_date", ship: "production_est_finish_date", target: "scheduled_delivery_date" } as const;
const LINE_FIELD = { start: "vendor_start_dates", ship: "vendor_ship_dates", target: "vendor_delivery_targets" } as const;
const NOUN = { start: "production start date", ship: "ship date", target: "delivery target" } as const;

const LABEL = "text-[10px] uppercase tracking-[0.16em] text-cream/60 mb-1.5";
const BADGE = "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0";
const BADGE_STYLE: React.CSSProperties = { background: "rgba(184,130,106,0.18)", border: "0.5px solid rgba(184,130,106,0.40)" };
const DATE_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.10)", border: "0.5px solid rgba(255,255,255,0.18)", borderRadius: "999px",
  color: "#e8e3da", colorScheme: "dark", fontFamily: "inherit", fontSize: "11px", height: "30px", padding: "0 12px",
};
/** The three columns: the line, Production, Delivery -- the same in the rows and the editor. */
const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(7rem, 10rem) minmax(0, 1.4fr) minmax(0, 1fr)", columnGap: "12px", alignItems: "center" };

export function CabinetLinesCard({
  order, updateOrderDetails, canEdit = true, readOnly = false,
}: {
  order: Order;
  updateOrderDetails: (id: string, details: DateFields & { delivery_method?: string }) => Promise<string | null>;
  canEdit?: boolean;
  readOnly?: boolean;
}) {
  const vendors = cabinetVendorsOf(order);
  const perLine = vendors.length > 1;
  // A line's own date, else the order's.
  const own = (f: Field, v: string): string => {
    if (f === "ship") return vendorShipDate(order, v) ?? "";
    const m = (order as unknown as Record<string, Record<string, string> | null | undefined>)[LINE_FIELD[f]];
    return (m && m[v]) || ((order as unknown as Record<string, string | null | undefined>)[ORDER_FIELD[f]] ?? "") || "";
  };
  const fromOrder = () => ({
    start: Object.fromEntries(vendors.map((v) => [v, own("start", v)])) as Record<string, string>,
    ship: Object.fromEntries(vendors.map((v) => [v, own("ship", v)])) as Record<string, string>,
    target: Object.fromEntries(vendors.map((v) => [v, own("target", v)])) as Record<string, string>,
  });
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState(fromOrder);
  const [shippingMethod, setShippingMethod] = useState(order.delivery_method ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Follow the row while it changes underneath (the run, a fulfilment, another tab).
  const key = JSON.stringify([order.production_start_date, order.production_est_finish_date, order.scheduled_delivery_date,
    order.vendor_start_dates, order.vendor_ship_dates, order.vendor_delivery_targets, order.shipped_in_shopify, order.delivery_method]);
  useEffect(() => { setDates(fromOrder()); setShippingMethod(order.delivery_method ?? ""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  const shipped = (v: string) => shippedOnText(order, `vendor:${v}`);
  const set = (f: Field, v: string, value: string) => setDates((d) => ({ ...d, [f]: { ...d[f], [v]: value } }));

  // ⚠ EVERY LINE'S DATE, OR NONE, per field -- a partial set cannot be saved, and
  // why is said beside Save (2026-11-02).
  const partial = perLine
    ? (["start", "ship", "target"] as Field[]).find((f) => {
        const n = vendors.filter((v) => dates[f][v]).length;
        return n > 0 && n < vendors.length;
      })
    : undefined;
  const blocked = partial ? `Set a ${NOUN[partial]} for each line, or none.` : null;

  /** One field's part of the save: the order's date, or every line's. */
  function fieldPatch(f: Field): Record<string, unknown> {
    const og = ORDER_FIELD[f], lf = LINE_FIELD[f];
    if (!perLine) return { [og]: dates[f][vendors[0]] || null };
    const hasMap = !!(order as unknown as Record<string, unknown>)[lf];
    const all = vendors.every((v) => dates[f][v]);
    if (!all) return { [og]: null, ...(hasMap ? { [lf]: null } : {}) };
    const changed = vendors.some((v) => dates[f][v] !== own(f, v));
    // An untouched save does not turn an order per-line: it re-sends the order's date.
    if (!hasMap && !changed) return { [og]: (order as unknown as Record<string, string | null>)[og] ?? null };
    return { [lf]: Object.fromEntries(vendors.map((v) => [v, dates[f][v]])) };
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const refused = await updateOrderDetails(order.id, {
        ...fieldPatch("start"), ...fieldPatch("ship"), ...fieldPatch("target"),
        delivery_method: shippingMethod.trim(),
      } as DateFields & { delivery_method?: string });
      if (refused) { setSaveError(refused); return; }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const range = (v: string) => {
    const a = formatMDY(own("start", v)), b = formatMDY(own("ship", v));
    return a || b ? `${a || "?"} \u2192 ${b || "?"}` : "Not set";
  };

  return (
    <div className="glass-sage rounded-panel px-4 py-3.5" data-card="cabinet-lines">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={BADGE} style={BADGE_STYLE}><Truck className="w-3.5 h-3.5" style={{ color: "#d9a888" }} /></span>
          <div className="min-w-0">
            <p className={LABEL + " mb-0"}>Production &amp; delivery</p>
            <p className="text-[11px] text-cream/55 mt-0.5">Each cabinet line&apos;s dates</p>
          </div>
        </div>
        {canEdit && !readOnly && (
          <button onClick={() => setEditing((e) => !e)}
            className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
            {editing ? "Done" : "Modify"}
          </button>
        )}
      </div>

      {/* The table: a row per line, Production and Delivery. */}
      <div className="mt-3" role="table" aria-label="Each cabinet line's dates">
        <div role="row" style={GRID} className="pb-1.5 border-b border-white/[0.08]">
          <span role="columnheader" className="text-[10px] uppercase tracking-[0.14em] text-cream/45">Line</span>
          <span role="columnheader" className="text-[10px] uppercase tracking-[0.14em] text-cream/45">Production</span>
          <span role="columnheader" className="text-[10px] uppercase tracking-[0.14em] text-cream/45">Delivery</span>
        </div>
        {vendors.map((v) => (
          <div role="row" key={v} style={GRID} className="py-1.5 border-b border-white/[0.06]">
            <span role="cell" className="text-[12px] text-cream/80">{v}</span>
            <span role="cell" className="text-[12px] text-cream/90">
              {range(v)}
              {shipped(v) && <span className="block text-[10.5px] text-cream/55">{shipped(v)}</span>}
            </span>
            <span role="cell" className={"text-[12px] " + (own("target", v) ? "text-cream/90" : "text-cream/45")}>{formatMDY(own("target", v)) || "Not set"}</span>
          </div>
        ))}
        <div style={GRID} className="py-1.5">
          <span className="text-[12px] text-cream/80">Shipping method</span>
          <span className="text-[12px] text-cream/90" style={{ gridColumn: "2 / 4" }}>{order.delivery_method || <span className="text-cream/45">Not set</span>}</span>
        </div>
      </div>

      {editing && canEdit && !readOnly && (
        <div className="mt-3 pt-3 border-t border-white/[0.08]">
          <p className={LABEL}>Production dates</p>
          {vendors.map((v) => (
            <div key={`p:${v}`} style={GRID} className="py-1">
              <span className="text-[11.5px] text-cream/70">{v}</span>
              {/* ⚠ SIDE BY SIDE, start -> end (2026-11-03, Garrett: "they are stacked"):
                  the boxes span both date columns and never wrap. */}
              <span className="flex items-center gap-1.5 flex-nowrap" style={{ gridColumn: "2 / 4" }}>
                <input type="date" value={dates.start[v] ?? ""} onChange={(e) => set("start", v, e.target.value)}
                  aria-label={`${v} production start date`} style={DATE_INPUT} />
                <span className="text-cream/30 text-[11px]">&rarr;</span>
                {shipped(v)
                  ? <span className="text-[11px] text-cream/70">{shipped(v)}</span>
                  : <input type="date" value={dates.ship[v] ?? ""} onChange={(e) => set("ship", v, e.target.value)}
                      aria-label={`${v} ship from factory date`} style={DATE_INPUT} />}
              </span>
            </div>
          ))}
          <p className={LABEL + " mt-3"}>Delivery dates</p>
          {vendors.map((v) => (
            <div key={`d:${v}`} style={GRID} className="py-1">
              <span className="text-[11.5px] text-cream/70">{v}</span>
              <span>
                <input type="date" value={dates.target[v] ?? ""} onChange={(e) => set("target", v, e.target.value)}
                  aria-label={`${v} delivery target`} style={DATE_INPUT} />
              </span>
              <span />
            </div>
          ))}
          <div style={GRID} className="py-1 mt-2">
            <span className="text-[11.5px] text-cream/70">Shipping method</span>
            <span>
              <input type="text" value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)}
                placeholder="Shipping method" aria-label="Shipping method" maxLength={100} style={DATE_INPUT} />
            </span>
            <span />
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => void save()} disabled={saving || !!blocked}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-full transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40">
              {saving ? "\u2026" : "Save"}
            </button>
            {blocked && <span className="text-[11px] text-cream/45">{blocked}</span>}
          </div>
          {saveError && <p role="alert" className="text-[11px] mt-1.5" style={{ color: "#e08585" }}>{saveError}</p>}
        </div>
      )}
    </div>
  );
}
