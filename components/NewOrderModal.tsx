"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import { Source, TYPE_UI, displayOrderNumber, type OrderType } from "@/lib/data";

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
  type: OrderType;
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

const LABEL_CLS = "block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5";

// Destructured as `orderType` so it cannot shadow anything named `type`
// elsewhere in this file.
export function NewOrderModal({ type: orderType, onClose }: NewOrderModalProps) {
  const ui = TYPE_UI[orderType] ?? TYPE_UI.order;
  const { addOrder, team, allOrdersIncludingArchived } = useStore();
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
  /**
   * The GROUP this claim is about. Warranty rows only; empty for every other
   * type, which has no parent.
   */
  const [aboutOrderId, setAboutOrderId] = useState("");
  const [aboutSearch, setAboutSearch] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // ⚠ The server refuses this too (422 about_order_id_required). Stopping
    // here as well means the person sees which field is missing rather than an
    // error after everything else they typed.
    if (orderType === "warranty" && !aboutOrderId) return;
    addOrder({
      type: orderType,
      // Only ever set on a claim; undefined is dropped by the route's explicit
      // newOrder object for every other type.
      about_order_id: orderType === "warranty" ? aboutOrderId : undefined,
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
    onClose();
  }

  /**
   * What a claim can be about.
   *
   * ⚠ ARCHIVED INCLUDED, ON PURPOSE. See the header: a purchase is archived
   * once delivered, and a claim is filed after delivery, so excluding archived
   * rows would hide the ordinary case.
   *
   * Claims are excluded -- a claim about a claim is not a thing -- and so are
   * custom jobs, which have no delivery for the Terms 12.3 window to run from.
   */
  const claimTargets = useMemo(() => {
    if (orderType !== "warranty") return [];
    const q = aboutSearch.trim().toLowerCase();
    return allOrdersIncludingArchived
      .filter((o) => o.type !== "warranty" && o.type !== "custom")
      .filter((o) => {
        if (!q) return true;
        return o.id.toLowerCase().includes(q)
          || (o.name ?? "").toLowerCase().includes(q)
          || displayOrderNumber(o).toLowerCase().includes(q);
      })
      .slice(0, 40);
  }, [orderType, aboutSearch, allOrdersIncludingArchived]);

  const chosenTarget = allOrdersIncludingArchived.find((o) => o.id === aboutOrderId);


  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
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
            onClick={onClose}
            className="p-1 rounded-lg transition-all hover:text-[#e8e3da]"
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

          {orderType === "warranty" && (
            <Field label="Which order is this claim about" required>
              <input
                value={aboutSearch}
                onChange={(e) => setAboutSearch(e.target.value)}
                placeholder="Search by order number or customer"
                style={GLASS_INPUT}
                className="placeholder:text-[rgba(232,227,218,0.20)] mb-2"
              />
              <div
                className="max-h-40 overflow-y-auto rounded-lg"
                style={{ border: "0.5px solid rgba(255,255,255,0.15)" }}
              >
                {claimTargets.length === 0 && (
                  <p className="text-[11px] px-3 py-2 text-[rgba(232,227,218,0.35)]">
                    No matching orders.
                  </p>
                )}
                {claimTargets.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => setAboutOrderId(o.id)}
                    className="w-full text-left px-3 py-2 text-xs transition-colors"
                    style={{
                      background: o.id === aboutOrderId
                        ? "rgba(145,165,151,0.25)" : "transparent",
                      color: "#e8e3da",
                    }}
                  >
                    <span className="font-medium">{displayOrderNumber(o)}</span>
                    <span className="text-[rgba(232,227,218,0.45)]">
                      {" \u00b7 "}{o.name}{" \u00b7 "}{o.stage}
                      {o.archived ? " \u00b7 archived" : ""}
                    </span>
                  </button>
                ))}
              </div>
              {chosenTarget && (
                <p className="text-[11px] mt-1.5 text-[rgba(232,227,218,0.45)]">
                  {/* The GROUP handle, shown because that is what gets stored
                      and what the claim reference is built from. */}
                  Claim will be filed against <span className="text-[#e8e3da]">{chosenTarget.id}</span>
                </p>
              )}
            </Field>
          )}

          <Field label={ui.detailLabel}>
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={ui.detailPlaceholder}
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          {orderType !== "warranty" && (
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
          )}

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

          {/* Footer buttons */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-xs transition-all hover:text-[#e8e3da]"
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
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
              style={{
                background: "rgba(86,100,72,0.22)",
                border: "0.5px solid rgba(86,100,72,0.70)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
                color: "#a0b890",
              }}
            >
              {ui.createCta}
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
