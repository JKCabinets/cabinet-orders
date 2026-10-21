"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import { Source, TYPE_UI, type OrderType } from "@/lib/data";

/**
 * ⚠ NO PRODUCT PICKER (2026-10-07). Until then this form carried a Shopify SKU
 * picker -- "SKUs & quantities", a vendor list, a catalogue search. It only ever
 * appeared on a CUSTOM job: this modal is opened for custom jobs alone (the
 * dashboard, and the orders hub, which opens WarrantyClaimModal for claims),
 * and the server creates nothing by hand but custom jobs and claims. A custom
 * job has no SKUs -- what the customer chose is recorded room by room in its
 * specifications -- and the catalogue came from /api/shopify/sync, which is
 * admin-only, so for everyone else the picker listed nothing. The one manual
 * row ever made had no SKU lines. Removed; the route and the admin Shopify
 * page that read the catalogue are unchanged.
 */
interface NewOrderModalProps {
  /**
   * The row type to create. This is the ONE component that still needs to
   * be told -- OrderModal and BulkActionBar read `.type` off the rows they
   * are handed, but here the row does not exist yet.
   */
  // ⚠ NEVER A CLAIM (2026-10-20). The orders hub opens WarrantyClaimModal for
  // claims and this for everything else, and the dashboard opens it for custom
  // jobs; the claim branch that was here could not be reached, so it is gone,
  // and the type now says so -- a caller passing "warranty" will not compile.
  type: Exclude<OrderType, "warranty">;
  onClose: () => void;
}

const MODAL: React.CSSProperties = {
  background: "rgba(36,52,66,0.97)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 32px 80px rgba(0,0,0,0.5)",
};

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


// Destructured as `orderType` so it cannot shadow anything named `type`
// elsewhere in this file.
export function NewOrderModal({ type: orderType, onClose }: NewOrderModalProps) {
  const ui = TYPE_UI[orderType] ?? TYPE_UI.order;
  const { addOrder, team } = useStore();
  const activeTeam = team.filter((m) => m.active);

  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState<Source>("Manual");
  const [member, setMember] = useState(activeTeam[0]?.initials ?? "AX");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [doorStyle, setDoorStyle] = useState("");
  const [color, setColor] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  // Kept as a STRING, not a number. "$4,500.00" is what a person types,
  // and parseMoney on the server accepts it; coercing here would fight the
  // user mid-keystroke and turn an empty box into 0.
  const [totalPrice, setTotalPrice] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /**
   * ⚠ ONE CREATE AT A TIME, AND THE MODAL WAITS FOR IT (2026-10-14). It used to
   * call addOrder without waiting and close at once, so a refusal had nowhere
   * to be shown -- and the store hid it behind a made-up row. Now it closes
   * only once the job exists; a refusal stays on screen with everything typed.
   * `inFlight` is the guard -- a ref, so a second press in the same instant
   * sees it -- and `submitting` is what the screen shows. While a create is
   * out, closing is refused too: the answer would have nowhere to land.
   */
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const close = () => { if (!inFlight.current) onClose(); };

  useEffect(() => {
    nameRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !inFlight.current) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!name.trim()) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const result = await addOrder({
      type: orderType,
      name, detail,
      source, member, notes,
      internal_notes: internalNotes,
      door_style: doorStyle,
      color,
      ship_to: shipTo,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      delivery_method: deliveryMethod,
      // Only ever set on a custom job -- the field is not rendered for
      // anything else, and an empty string parses to null server-side.
      total_price: orderType === "custom" ? totalPrice : undefined,
    });
    if (result.ok) { onClose(); return; }   // still in flight: the modal is going
    inFlight.current = false;
    setSubmitting(false);
    setSubmitError(result.message ?? result.error ?? "The job could not be created.");
  }



  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && close()}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fade-in"
      style={{ background: "rgba(0,0,0,0.60)" }}
    >
      <div
        className="w-full md:w-[520px] max-h-[92vh] rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-in flex flex-col"
        style={MODAL}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "0.5px solid rgba(255,255,255,0.15)" }}
        >
          <h2 className="text-sm font-semibold text-[#e8e3da]">
            {ui.createTitle}
          </h2>
          <button
            onClick={close}
            disabled={submitting}
            className="p-1 rounded-lg transition-all hover:text-[#e8e3da] disabled:opacity-40"
            style={{ color: "rgba(232,227,218,0.60)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5 overflow-y-auto">

          <Field label="Customer name" required>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer phone">
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(555) 000-0000"
                style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]"
              />
            </Field>
            <Field label="Customer email">
              <input
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="email@example.com"
                style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]"
              />
            </Field>
          </div>

          {/* Job total -- CUSTOM jobs only.
              A Shopify checkout's total belongs to the PROJECT: one charge,
              one total, and orders_total_price_standalone_only forbids a
              project-linked row from carrying one at all. This route creates
              standalone rows, so the constraint is satisfied by construction --
              but showing the field on a manual cabinet order would invite
              somebody to price something the OMS does not bill for. */}
          {orderType === "custom" && (
            <Field label="Job total">
              <input
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="$0.00"
                inputMode="decimal"
                style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]"
              />
            </Field>
          )}

          <Field label="Ship to address">
            <input
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              placeholder="Street, City, State ZIP"
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>


          <Field label={ui.detailLabel}>
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={ui.detailPlaceholder}
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Door style">
              <input value={doorStyle} onChange={(e) => setDoorStyle(e.target.value)}
                placeholder="e.g. Shaker" style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]" />
            </Field>
            <Field label="Color">
              <input value={color} onChange={(e) => setColor(e.target.value)}
                placeholder="e.g. White" style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
                style={GLASS_INPUT}
                className="appearance-none text-sm"
              >
                <option value="Manual">Manual</option>
                <option value="Shopify">Shopify</option>
              </select>
            </Field>
            <Field label="Delivery method">
              <input
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value)}
                placeholder="e.g. UPS or Freight"
                style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)]"
              />
            </Field>
          </div>

          <Field label="Team member">
              <select
                value={member}
                onChange={(e) => setMember(e.target.value)}
                style={GLASS_INPUT}
                className="appearance-none text-sm"
              >
                {activeTeam.map((m) => (
                  <option key={m.id} value={m.initials}>{m.initials} — {m.name}</option>
                ))}
              </select>
            </Field>

          <Field label="Customer Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Visible to the customer (synced to Shopify)…"
              rows={2}
              style={{ ...GLASS_INPUT, resize: "none" }}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          <Field label="Internal Notes (staff only)">
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Visible to staff only — appears on the export PDF, never sent to Shopify."
              rows={2}
              style={{
                ...GLASS_INPUT,
                resize: "none",
                background: "rgba(224,85,85,0.04)",
                border: "0.5px dashed rgba(224,85,85,0.3)",
              }}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          {submitError && (
            <p role="alert" className="text-[11px] text-red-400">
              {submitError}
            </p>
          )}

          {/* Footer buttons */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg text-xs transition-all hover:text-[#e8e3da] disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "0.5px solid rgba(255,255,255,0.18)",
                color: "rgba(232,227,218,0.70)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "rgba(86,100,72,0.22)",
                border: "0.5px solid rgba(86,100,72,0.70)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
                color: "#a0b890",
              }}
            >
              {submitting ? "Saving…" : ui.createCta}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5`}>
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
