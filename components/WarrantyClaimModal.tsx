"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Search, Check, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { displayOrderNumber, TYPE_LIST_LABEL, type Order, type SkuItem } from "@/lib/data";

/**
 * Logging a warranty claim.
 *
 * ⚠ THE ORDER COMES FIRST, AND THAT IS THE WHOLE STRUCTURE. A claim is about a
 * GROUP -- `about_order_id`'s declaration says so, "because the 48-hour window
 * in Terms 12.3 runs from a delivery, and deliveries are per group". A
 * checkout of cabinets, hardware and samples has three, delivered at different
 * times, so "which order" is not one question but two: which purchase, then
 * which part of it.
 *
 * The flat picker this replaces asked only the first. It rendered
 * `displayOrderNumber`, which collapses a group to its project, so
 * SHO-1051-CAB and SHO-1051-SMP both read "SHO-1051" and the person choosing
 * could not tell them apart.
 *
 * ⚠ ARCHIVED PURCHASES ARE INCLUDED. A purchase is archived once every group
 * reaches the end of its flow; a claim is filed after delivery. The orders
 * most likely to be claimed against are exactly the ones `allOrders` drops.
 *
 * ⚠ BUILT TO SERVE PROMOTION TOO. Passing a `submission` prefills the claim
 * from a customer's public form and narrows the order list to what they typed.
 * Same screen, same fields, one implementation -- building the triage version
 * separately is how this codebase ended up with three warranty id generators.
 */

const GLASS_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.18)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  borderRadius: "8px",
  color: "#e8e3da",
  fontFamily: "inherit",
  fontSize: "16px",
  padding: "7px 11px",
  width: "100%",
  transition: "border-color 0.15s",
};

const LABEL_CLS =
  "block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5";

const HAIRLINE = "0.5px solid rgba(255,255,255,0.12)";

/** Stage colours already encode state everywhere else; reuse rather than invent. */
const STAGE_TINT: Record<string, string> = {
  "New": "#c97070", "New claim": "#c97070",
  "Entered": "#d4922a", "Ordered": "#d4922a", "In review": "#d4922a",
  "In production": "#c8b84a", "Parts ordered": "#c8b84a",
  "At cross dock": "#5a8db8", "Shipped": "#5a8db8",
  "Delivered": "#8fbe70", "Resolved": "#8fbe70",
};

export interface ClaimSubmissionSeed {
  id: string;
  order_number: string | null;
  order_number_raw: string;
  claim_type: string;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string | null;
  message: string | null;
  received_at: string;
}

interface Props {
  onClose: () => void;
  /** Present when promoting a customer submission rather than logging by hand. */
  submission?: ClaimSubmissionSeed | null;
}

interface ClaimLine {
  key: string;
  sku: string;
  /**
   * ⚠ FREE TEXT, NOT THE PARENT'S PRODUCT NAME. A customer with a damaged B12
   * needs "top drawer front only" recorded, not "Base Cabinet 12"". What is
   * being replaced is rarely the whole line item, and the vendor needs the
   * distinction to fill the order.
   */
  description: string;
  quantity: number;
  purchased: number | null;
}

export function WarrantyClaimModal({ onClose, submission }: Props) {
  const { addOrder, allOrdersIncludingArchived, projects } = useStore();

  const [search, setSearch] = useState(submission?.order_number ?? "");
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");

  const [name, setName] = useState(submission?.claimant_name ?? "");
  const [email, setEmail] = useState(submission?.claimant_email ?? "");
  const [phone, setPhone] = useState(submission?.claimant_phone ?? "");
  const [shipTo, setShipTo] = useState("");
  const [issue, setIssue] = useState(submission?.message ?? "");
  const [internalNote, setInternalNote] = useState("");
  const [lines, setLines] = useState<ClaimLine[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [expectedShip, setExpectedShip] = useState("");
  const [prodStart, setProdStart] = useState("");
  const [prodFinish, setProdFinish] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Purchases, with their groups nested ──────────────────────────────────
  const purchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byPurchase = new Map<string, Order[]>();

    for (const o of allOrdersIncludingArchived) {
      // A claim about a claim is not a thing. A custom job has no delivery for
      // the Terms 12.3 window to run from.
      if (o.type === "warranty" || o.type === "custom") continue;
      const key = displayOrderNumber(o);
      const bucket = byPurchase.get(key);
      if (bucket) bucket.push(o); else byPurchase.set(key, [o]);
    }

    return [...byPurchase.entries()]
      .map(([reference, groups]) => ({
        reference,
        groups: groups.sort((a, b) => a.type.localeCompare(b.type)),
        customer: groups[0]?.name ?? "",
        shipTo: groups[0]?.ship_to ?? "",
        date: groups[0]?.date ?? "",
        source: groups[0]?.source ?? "",
      }))
      .filter((p) => {
        if (!q) return true;
        return p.reference.toLowerCase().includes(q)
          || p.customer.toLowerCase().includes(q)
          || p.shipTo.toLowerCase().includes(q);
      })
      .sort((a, b) => b.reference.localeCompare(a.reference))
      .slice(0, 30);
  }, [allOrdersIncludingArchived, search]);

  const group = allOrdersIncludingArchived.find((o) => o.id === groupId) ?? null;
  const project = group?.project_id ? projects[group.project_id] : undefined;

  /** Cabinets are the only flow with a production step to date. */
  const isCabinetClaim = group?.type === "order";

  // Open the purchase a submission points at, and pick its group when there is
  // only one -- with two or more, the person chooses. Guessing "the cabinets"
  // would be right most of the time, which is worse than asking.
  useEffect(() => {
    if (!submission?.order_number || openProject) return;
    const match = purchases.find((p) => p.reference === submission.order_number);
    if (!match) return;
    setOpenProject(match.reference);
    if (match.groups.length === 1) setGroupId(match.groups[0].id);
  }, [submission, purchases, openProject]);

  // Pull the customer and the purchased lines across when a group is chosen.
  // Anything already typed wins: a person correcting a phone number should not
  // have it overwritten by picking a different group.
  useEffect(() => {
    if (!group) return;
    setName((v) => v || group.name || "");
    setEmail((v) => v || group.customer_email || "");
    setPhone((v) => v || group.customer_phone || "");
    setShipTo((v) => v || group.ship_to || "");
    setLines(
      (group.sku_items ?? []).map((i: SkuItem, n: number) => ({
        key: `${group.id}-${n}`,
        sku: i.sku,
        description: i.description ?? "",
        quantity: 0,
        purchased: i.quantity ?? null,
      })),
    );
  }, [group]);

  const claimedLines = lines.filter((l) => l.quantity > 0);
  const canSave = !!groupId && !!name.trim() && !!issue.trim() && !saving;

  function setLine(key: string, patch: Partial<ClaimLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleCreate() {
    if (!canSave || !group) return;
    setSaving(true);
    setError("");
    try {
      await addOrder({
        type: "warranty",
        about_order_id: group.id,
        name: name.trim(),
        detail: issue.trim().slice(0, 500),
        customer_email: email.trim(),
        customer_phone: phone.trim(),
        ship_to: shipTo.trim(),
        internal_notes: internalNote.trim(),
        delivery_method: deliveryMethod.trim(),
        claimant_name: name.trim(),
        claimant_email: email.trim(),
        sku_items: claimedLines.map((l) => ({
          sku: l.sku,
          quantity: l.quantity,
          description: l.description,
        })),
        // ⚠ EXISTING COLUMNS, NOT NEW ONES. `Shipped` is the stage that waits
        // on parts leaving, so the expected ship date lives in
        // scheduled_delivery_date; `Parts ordered` on a cabinet claim waits on
        // a build, so it uses the production dates. Both stages currently have
        // NO SLA rule -- sla.ts says there is no field that would say when to
        // stop worrying. After this there is one.
        scheduled_delivery_date: expectedShip || null,
        production_start_date: isCabinetClaim ? (prodStart || null) : null,
        production_est_finish_date: isCabinetClaim ? (prodFinish || null) : null,
      } as Parameters<typeof addOrder>[0]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the claim.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(10,21,32,0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 py-5" style={{ borderBottom: HAIRLINE }}>
          <div>
            <h2 className="font-display text-[22px] leading-tight text-cream">New warranty claim</h2>
            <p className="text-[12px] text-[rgba(232,227,218,0.45)] mt-0.5">
              {submission
                ? `From a customer claim submitted ${new Date(submission.received_at).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Phoenix" })}`
                : "Against an existing customer order."}
            </p>
          </div>
          <button onClick={onClose} className="text-[rgba(232,227,218,0.45)] hover:text-cream transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-[minmax(0,340px)_minmax(0,1fr)]">

          {/* ── Left: which order ─────────────────────────────────────── */}
          <div className="overflow-y-auto p-5" style={{ borderRight: HAIRLINE }}>
            <label className={LABEL_CLS}>Original order</label>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(232,227,218,0.35)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Order number, customer or address"
                style={{ ...GLASS_INPUT, paddingLeft: "32px", fontSize: "13px" }}
                className="placeholder:text-[rgba(232,227,218,0.25)]"
              />
            </div>

            {purchases.length === 0 && (
              <p className="text-[12px] text-[rgba(232,227,218,0.35)] py-6 text-center">
                No orders match that. Try the order number on its own.
              </p>
            )}

            <div className="space-y-2">
              {purchases.map((p) => {
                const open = openProject === p.reference;
                return (
                  <div key={p.reference} className="rounded-xl overflow-hidden" style={{ border: HAIRLINE }}>
                    <button
                      type="button"
                      onClick={() => setOpenProject(open ? null : p.reference)}
                      className="w-full text-left px-3.5 py-3 transition-colors"
                      style={{ background: open ? "rgba(255,255,255,0.05)" : "transparent" }}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-display text-[17px] text-cream">{p.reference}</span>
                        <span className="text-[11px] text-[rgba(232,227,218,0.45)] shrink-0">{p.date}</span>
                      </div>
                      <div className="text-[12px] text-[rgba(232,227,218,0.55)] mt-0.5 truncate">
                        {p.customer}{p.shipTo ? ` — ${p.shipTo}` : ""}
                      </div>
                    </button>

                    {open && (
                      <div style={{ borderTop: HAIRLINE }}>
                        {p.groups.map((g) => {
                          const chosen = g.id === groupId;
                          return (
                            <button
                              type="button"
                              key={g.id}
                              onClick={() => setGroupId(g.id)}
                              className="w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors"
                              style={{ background: chosen ? "rgba(145,165,151,0.22)" : "transparent" }}
                            >
                              <span
                                className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center"
                                style={{
                                  border: chosen ? "none" : "1px solid rgba(255,255,255,0.25)",
                                  background: chosen ? "#91a597" : "transparent",
                                }}
                              >
                                {chosen && <Check className="w-2.5 h-2.5" style={{ color: "#162432" }} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="text-[13px] text-cream block">
                                  {TYPE_LIST_LABEL[g.type]}
                                </span>
                                <span className="text-[11px] text-[rgba(232,227,218,0.40)] block truncate">
                                  {g.id}
                                  {g.archived ? " · archived" : ""}
                                </span>
                              </span>
                              <span
                                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                                style={{
                                  color: STAGE_TINT[g.stage] ?? "#91a597",
                                  border: `0.5px solid ${STAGE_TINT[g.stage] ?? "#91a597"}55`,
                                }}
                              >
                                {g.stage}
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
          </div>

          {/* ── Right: the claim ──────────────────────────────────────── */}
          <div className="overflow-y-auto p-6 space-y-6">
            {!group && (
              <div className="h-full flex items-center justify-center">
                <p className="text-[13px] text-[rgba(232,227,218,0.35)] max-w-xs text-center">
                  Choose the order this claim is about. A purchase can hold cabinets,
                  hardware and samples, delivered at different times — pick the one
                  with the problem.
                </p>
              </div>
            )}

            {group && (
              <>
                {/* Selected order */}
                <section>
                  <div className="rounded-xl p-4" style={{ border: HAIRLINE, background: "rgba(255,255,255,0.03)" }}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <h3 className="font-display text-[19px] text-cream">{group.id}</h3>
                      <span className="text-[11px] text-[rgba(232,227,218,0.45)]">
                        {group.source} · {group.date}
                      </span>
                    </div>
                    <p className="text-[12px] text-[rgba(232,227,218,0.55)]">
                      {TYPE_LIST_LABEL[group.type]} · {group.stage}
                      {project?.total_price != null ? ` · $${project.total_price}` : ""}
                    </p>
                  </div>
                </section>

                {/* Who */}
                <section>
                  <label className={LABEL_CLS}>Customer</label>
                  <div className="grid grid-cols-2 gap-3">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
                      style={GLASS_INPUT} className="placeholder:text-[rgba(232,227,218,0.20)]" />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com"
                      style={GLASS_INPUT} className="placeholder:text-[rgba(232,227,218,0.20)]" />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000"
                      style={GLASS_INPUT} className="placeholder:text-[rgba(232,227,218,0.20)]" />
                    <input value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder="Ship to address"
                      style={GLASS_INPUT} className="placeholder:text-[rgba(232,227,218,0.20)]" />
                  </div>
                </section>

                {/* What went wrong */}
                <section>
                  <label className={LABEL_CLS}>What is wrong</label>
                  <textarea
                    value={issue}
                    onChange={(e) => setIssue(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="What is damaged or missing, and what needs replacing."
                    style={{ ...GLASS_INPUT, resize: "vertical", fontSize: "14px" }}
                    className="placeholder:text-[rgba(232,227,218,0.20)]"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[11px] text-[rgba(232,227,218,0.30)]">
                      {submission ? "From the customer's form. Edit before creating." : ""}
                    </span>
                    <span className="text-[11px] text-[rgba(232,227,218,0.30)]">{issue.length}/500</span>
                  </div>
                  <input
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Internal note — not shown to the customer"
                    style={{ ...GLASS_INPUT, fontSize: "13px", marginTop: "10px" }}
                    className="placeholder:text-[rgba(232,227,218,0.20)]"
                  />
                </section>

                {/* What is being replaced */}
                <section>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className={LABEL_CLS + " mb-0"}>What needs replacing</label>
                    <span className="text-[11px] text-[rgba(232,227,218,0.35)]">
                      {claimedLines.length === 0 ? "none selected" : `${claimedLines.length} of ${lines.length}`}
                    </span>
                  </div>

                  {lines.length === 0 && (
                    <p className="text-[12px] text-[rgba(232,227,218,0.35)] py-3">
                      This order has no recorded line items. Add what needs replacing below.
                    </p>
                  )}

                  <div className="rounded-xl overflow-hidden" style={{ border: HAIRLINE }}>
                    {lines.map((l, i) => (
                      <div
                        key={l.key}
                        className="grid grid-cols-[100px_minmax(0,1fr)_auto] gap-3 items-center px-3 py-2.5"
                        style={{
                          borderTop: i === 0 ? "none" : HAIRLINE,
                          background: l.quantity > 0 ? "rgba(145,165,151,0.12)" : "transparent",
                        }}
                      >
                        <span className="text-[12px] text-[rgba(232,227,218,0.65)] truncate" title={l.sku}>
                          {l.sku}
                        </span>
                        {/* Free text: "top drawer front only", not the whole B12. */}
                        <input
                          value={l.description}
                          onChange={(e) => setLine(l.key, { description: e.target.value })}
                          placeholder="What part of it — e.g. top drawer front only"
                          style={{ ...GLASS_INPUT, fontSize: "13px", padding: "5px 9px" }}
                          className="placeholder:text-[rgba(232,227,218,0.20)]"
                        />
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setLine(l.key, { quantity: Math.max(0, l.quantity - 1) })}
                            className="w-6 h-6 rounded-md text-cream text-sm leading-none"
                            style={{ border: HAIRLINE }} aria-label="One fewer">−</button>
                          <span className="w-6 text-center text-[13px] text-cream tabular-nums">{l.quantity}</span>
                          <button type="button" onClick={() => setLine(l.key, { quantity: l.quantity + 1 })}
                            className="w-6 h-6 rounded-md text-cream text-sm leading-none"
                            style={{ border: HAIRLINE }} aria-label="One more">+</button>
                          <span className="text-[11px] text-[rgba(232,227,218,0.30)] w-14 shrink-0">
                            {l.purchased != null ? `of ${l.purchased}` : ""}
                          </span>
                          {l.purchased == null && (
                            <button type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                              className="text-[rgba(232,227,218,0.35)] hover:text-cream" aria-label="Remove line">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setLines((p) => [...p, {
                        key: `extra-${Date.now()}`, sku: "", description: "", quantity: 1, purchased: null,
                      }])}
                      className="w-full px-3 py-2.5 text-[12px] text-[rgba(232,227,218,0.55)] hover:text-cream flex items-center gap-1.5 transition-colors"
                      style={{ borderTop: lines.length ? HAIRLINE : "none" }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add something not on the order
                    </button>
                  </div>
                </section>

                {/* Dates */}
                <section>
                  <label className={LABEL_CLS}>Fulfilment</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[11px] text-[rgba(232,227,218,0.40)] block mb-1">Delivery method</span>
                      <input value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}
                        placeholder="e.g. UPS or Freight" style={GLASS_INPUT}
                        className="placeholder:text-[rgba(232,227,218,0.20)]" />
                    </div>
                    <div>
                      <span className="text-[11px] text-[rgba(232,227,218,0.40)] block mb-1">Expected ship date</span>
                      <input type="date" value={expectedShip} onChange={(e) => setExpectedShip(e.target.value)}
                        style={GLASS_INPUT} />
                    </div>
                    {isCabinetClaim && (
                      <>
                        <div>
                          <span className="text-[11px] text-[rgba(232,227,218,0.40)] block mb-1">Production starts</span>
                          <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)}
                            style={GLASS_INPUT} />
                        </div>
                        <div>
                          <span className="text-[11px] text-[rgba(232,227,218,0.40)] block mb-1">Production finishes</span>
                          <input type="date" value={prodFinish} onChange={(e) => setProdFinish(e.target.value)}
                            style={GLASS_INPUT} />
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-[rgba(232,227,218,0.30)] mt-1.5">
                    Both are estimates and can be left empty. Production dates only apply
                    to cabinet claims, which are built before they ship.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: HAIRLINE }}>
          <div className="text-[12px] min-h-[18px]">
            {error && <span style={{ color: "#e0806a" }}>{error}</span>}
            {!error && group && (
              <span className="text-[rgba(232,227,218,0.40)]">
                Filed against <span className="text-cream">{group.id}</span>, assigned to you
              </span>
            )}
            {!error && !group && (
              <span className="text-[rgba(232,227,218,0.30)]">Choose an order to continue</span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={onClose}
              className="px-4 py-2 rounded-full text-[12px] uppercase tracking-wider text-[rgba(232,227,218,0.55)] hover:text-cream transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!canSave}
              className="px-5 py-2 rounded-full text-[12px] uppercase tracking-wider font-medium transition-all disabled:opacity-35 disabled:cursor-not-allowed"
              style={{ background: "#576257", color: "#f0ece4", border: "0.5px solid rgba(145,165,151,0.45)" }}
            >
              {saving ? "Creating" : "Create claim"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
