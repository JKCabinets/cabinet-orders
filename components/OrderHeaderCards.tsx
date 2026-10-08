"use client";

import { AlertTriangle } from "lucide-react";
import { poReference, displayOrderNumber, type Order, type TeamMember } from "@/lib/data";
import { customerIssues, keyedByName, type AckIssues } from "@/lib/orderIssues";

/**
 * The order's details, as the head of the vendor PDF shows them (Garrett,
 * 2026-10-07), at the top of the Full Order tab: the order (Keyed By, Ordered
 * On, PO, Status, internal notes below it; Delivery Method, Vendor, Shopify Id)
 * and the customer.
 *
 * ⚠ THE SAME CHECKS AS THE PDF, from lib/orderIssues: a value the PDF flags
 * amber is flagged amber here, and the reasons are listed above the cards. The
 * acknowledgment's differing name or address shows under the value.
 */

const AMBER = "#e8b866";

function Row({ label, value, flag, note, small }: { label: string; value: React.ReactNode; flag?: boolean; note?: string; small?: boolean }) {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-2 px-2 py-1.5 rounded-md"
      style={flag ? { background: "rgba(224,168,72,0.10)" } : undefined}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: flag ? AMBER : "rgba(232,227,218,0.45)" }}>{label}</span>
      <span className={`${small ? "text-[11px]" : "text-[12px]"} text-cream/85 break-words`}>
        {value}
        {note && <span className="block text-[10px] italic mt-0.5" style={{ color: AMBER }}>{note}</span>}
      </span>
    </div>
  );
}

const missing = <span className="italic" style={{ color: AMBER }}>Missing</span>;
const orDash = (v: unknown) => (String(v ?? "").trim() ? String(v) : "\u2014");
const orMissing = (v: unknown) => (String(v ?? "").trim() ? String(v) : missing);

export function OrderHeaderCards({ order, team, ack }: { order: Order; team: TeamMember[]; ack?: AckIssues | null }) {
  const people = team;
  const issue = customerIssues(order);
  const keyedBy = keyedByName(order, (id) => people.find((m) => m.id === id)?.name)
    || people.find((m) => m.initials && m.initials === order.member)?.name || order.member || "\u2014";
  const fields = ack?.fields ?? {};
  const reasons = [
    ...(ack && ack.summary ? [ack.summary] : []),
    ...Object.values(issue).filter(Boolean),
  ];

  return (
    <div className="mb-4">
      {reasons.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-lg text-[11px]"
          style={{ background: "rgba(224,168,72,0.08)", border: "0.5px solid rgba(224,168,72,0.40)", color: AMBER }}>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Needs review: {reasons.join(" \u00b7 ")}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg p-2" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
          <Row label="Keyed By" value={keyedBy} />
          <Row label="Ordered On" value={orDash(order.date)} />
          <Row label="PO" value={poReference(order)} flag={!!issue.name} />
          <Row label="Status" value={orDash(order.stage)} />
          {String(order.internal_notes ?? "").trim() && (
            <Row label="Internal notes" small value={
              <>
                <span className="inline-block text-[9px] uppercase tracking-wider px-2 py-px mb-1 rounded-full"
                  style={{ color: "#e89090", border: "0.5px solid rgba(201,112,112,0.5)" }}>Not for customer</span>
                <span className="block whitespace-pre-wrap">{order.internal_notes}</span>
              </>
            } />
          )}
          <Row label="Delivery" small value={orDash(order.delivery_method)} />
          <Row label="Vendor" small value={orDash(order.vendor)} />
          <Row label="Shopify Id" small value={orDash(order.shopify_id) === "\u2014" ? displayOrderNumber(order) : String(order.shopify_id)} />
        </div>
        <div className="rounded-lg p-2" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
          <Row label="Customer" value={orMissing(order.name)} flag={!!(issue.name || fields.name)} note={fields.name} />
          <Row label="Ship to" value={orMissing(order.ship_to)} flag={!!(issue.shipTo || fields.address)} note={fields.address} />
          <Row label="Phone" value={orMissing(order.customer_phone)} flag={!!(issue.phone || fields.phone)} note={fields.phone} />
          <Row label="Instructions" small value={orDash(order.notes)} />
          <Row label="Email" value={orMissing(order.customer_email)} flag={!!issue.email} />
        </div>
      </div>
    </div>
  );
}
