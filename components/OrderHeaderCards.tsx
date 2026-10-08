"use client";

import { AlertTriangle } from "lucide-react";
import { poReference, displayOrderNumber, type Order, type Project, type TeamMember } from "@/lib/data";
import { consentRequired, consentMissing, formatAgreed, CONSENT_WORDING } from "@/lib/consent";
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

/**
 * "No terms consent", for the modal's top line (2026-10-07): visible from every
 * tab, so staff get consent before production. Nothing when consent is there
 * or not required (lib/consent).
 */
export function ConsentMissingPill({ project }: { project: Project | null | undefined }) {
  if (!consentMissing(project)) return null;
  return (
    <span className="inline-flex items-center gap-1 ml-2 px-2 py-px rounded-full text-[9px] uppercase tracking-wider font-medium align-middle"
      style={{ color: AMBER, background: "rgba(224,168,72,0.10)", border: "0.5px solid rgba(224,168,72,0.45)" }}>
      <AlertTriangle className="w-2.5 h-2.5" /> No terms consent
    </span>
  );
}

export function OrderHeaderCards({ order, team, ack, project }: { order: Order; team: TeamMember[]; ack?: AckIssues | null; project?: Project | null }) {
  const people = team;
  const issue = customerIssues(order);
  const keyedBy = keyedByName(order, (id) => people.find((m) => m.id === id)?.name)
    || people.find((m) => m.initials && m.initials === order.member)?.name || order.member || "\u2014";
  const fields = ack?.fields ?? {};
  const reasons = [
    ...(ack && ack.summary ? [ack.summary] : []),
    ...Object.values(issue).filter(Boolean),
    ...(consentMissing(project) ? ["No terms consent: get it before production"] : []),
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
          {consentRequired(project) || project?.terms_agreed ? (
            <Row label="Terms consent" small flag={consentMissing(project)} value={
              project?.terms_agreed ? (
                <>
                  <span className="block">{formatAgreed(project.terms_agreed)}{project.consent_source ? ` \u00b7 ${project.consent_source}` : ""}</span>
                  <span className="block text-cream/45">
                    Wording {project.consent_wording || "\u2014"} {"\u00b7"} Terms {project.terms_version || "\u2014"}
                  </span>
                  {project.consent_wording && CONSENT_WORDING[project.consent_wording] && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[10px] text-cream/45 hover:text-cream/70">What they agreed to</summary>
                      <span className="block mt-1 text-[10px] text-cream/65 leading-relaxed">{CONSENT_WORDING[project.consent_wording]}</span>
                    </details>
                  )}
                </>
              ) : <span className="italic" style={{ color: AMBER }}>Missing: get consent before production</span>
            } />
          ) : null}
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
