"use client";

import type { Order } from "@/lib/data";

/**
 * What the customer ASKED FOR, exactly as the website form sent it.
 *
 * ⚠ READ-ONLY, AND NOT THE DESIGNER'S RECORD. The specs panel above holds what
 * the customer CHOSE, recorded by a designer after talking to them. This holds
 * the request: several door styles, several colours, a budget band, a timeline.
 * Nothing in the OMS writes to `quote_submission` after ingest, so this panel
 * offers nothing -- it is a record, and a record you can edit is not one.
 *
 * ⚠ LABELS, NEVER KEYS. The form sends a stable key (`5k_10k`) and the words the
 * customer actually read (`$5,000 to $10,000`). The key is for us; the label is
 * what was on their screen. Showing `5k_10k` to a designer asking "what did they
 * want?" is the same class of untruth as storing it in notes, which is what this
 * replaces. A key with no label falls back to the key rather than showing blank.
 *
 * ⚠ TOTAL OVER WHAT IT FINDS. A job created by hand has no submission at all; a
 * job from before 2026-09-24 has a null column; a future form version may send
 * shapes this build has never seen. Each renders as "nothing here" or is skipped,
 * never as a crash inside a modal somebody opened to do their work.
 */
type Choice = { key?: unknown; label?: unknown } | null | undefined;
type MultiChoice = { keys?: unknown; labels?: unknown } | null | undefined;

const one = (c: Choice): string => {
  if (!c || typeof c !== "object") return "";
  const label = typeof c.label === "string" ? c.label.trim() : "";
  const key = typeof c.key === "string" ? c.key.trim() : "";
  return label || key;
};

const many = (c: MultiChoice): string[] => {
  if (!c || typeof c !== "object") return [];
  const labels = Array.isArray(c.labels) ? c.labels : [];
  const keys = Array.isArray(c.keys) ? c.keys : [];
  const source = labels.length ? labels : keys;
  return source.filter((v): v is string => typeof v === "string" && v.trim() !== "");
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function QuoteSubmissionPanel({ order }: { order: Order }) {
  const raw = order.quote_submission;
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, Record<string, unknown> | unknown>;
  const choices = (doc.choices ?? {}) as Record<string, unknown>;
  const body = (doc.text ?? {}) as Record<string, unknown>;

  const styles = many(choices.door_style as MultiChoice);
  const colors = many(choices.color as MultiChoice);
  const rows: Array<[string, string]> = [
    ["Budget", one(choices.budget as Choice)],
    ["Project type", one(choices.project_type as Choice)],
    ["Home type", one(choices.home_type as Choice)],
    ["Timeline", one(choices.timeline as Choice)],
  ].filter(([, v]) => v !== "") as Array<[string, string]>;

  const wantsDesignHelp = text(choices.design_assistance) === "yes";
  const notes = text(body.notes);
  const finishNotes = text(body.finish_notes);
  const files = (Array.isArray(doc.files_meta) ? doc.files_meta : [])
    .map((f) => (f && typeof f === "object" ? text((f as Record<string, unknown>).name) : ""))
    .filter(Boolean);

  const customer = (doc.customer ?? {}) as Record<string, unknown>;
  const project = (doc.project ?? {}) as Record<string, unknown>;
  const contactName = [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ");
  const phone = text(customer.phone);
  const email = text(customer.email);
  const address = text(project.address)
    || [text(project.street), text(project.city), text(project.state), text(project.zip)].filter(Boolean).join(", ");

  const submitted = text(doc.submitted_at);
  const submittedLabel = submitted
    ? new Date(submitted).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" })
    : "";

  const chip = (label: string) => (
    <span key={label} className="px-2 py-0.5 rounded-full text-[10px] bg-white/5 border border-white/10 text-cream/70">
      {label}
    </span>
  );

  return (
    // ⚠ NO TOP MARGIN. This panel sits BESIDE the specs card in a two-column
    // grid, not under it; a margin here pushed its top edge out of line.
    <div className="rounded-brand" style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.07)" }}>
      <div className="px-4 py-3">
        <p className="text-[13px] text-cream/90">Submitted website preferences</p>
        <p className="text-[11px] text-cream/45">
          What the customer asked for on the quote form{submittedLabel ? `, ${submittedLabel}` : ""}. Not editable.
        </p>
      </div>

      {/* ⚠ THE ONLY PLACE THE MODAL SHOWS THESE. The order-details card carries
          source, date, PO reference and type -- not the customer's phone, email
          or address. They were shown by QuoteInfoPanel, which parsed them out of
          the notes prose; they are read from the submission now. */}
      {(contactName || phone || email || address) && (
        <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {contactName && (
            <div className="md:col-span-2">
              <p className="text-[9px] uppercase tracking-wider text-cream/35">Name</p>
              <p className="text-[12px] text-cream/80">{contactName}</p>
            </div>
          )}
          {phone && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-cream/35">Phone</p>
              <p className="text-[12px] text-cream/80">{phone}</p>
            </div>
          )}
          {email && (
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-cream/35">Email</p>
              <p className="text-[12px] text-cream/80 truncate" title={email}>{email}</p>
            </div>
          )}
          {address && (
            <div className="md:col-span-2">
              <p className="text-[9px] uppercase tracking-wider text-cream/35">Project address</p>
              <p className="text-[12px] text-cream/80">{address}</p>
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        <div className="space-y-3">
          {styles.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1.5">Preferred door styles</p>
              <div className="flex flex-wrap gap-1.5">{styles.map(chip)}</div>
            </div>
          )}
          {colors.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1.5">Preferred colors</p>
              <div className="flex flex-wrap gap-1.5">{colors.map(chip)}</div>
            </div>
          )}
          {finishNotes && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Finish notes</p>
              <p className="text-[11px] text-cream/70 whitespace-pre-wrap">{finishNotes}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wider text-cream/35">{label}</span>
              <span className="text-[11px] text-cream/75 text-right">{value}</span>
            </div>
          ))}
          {wantsDesignHelp && (
            <p className="text-[11px]" style={{ color: "#b8d0bd" }}>Asked for design assistance</p>
          )}
          {files.length > 0 && (
            <div className="pt-1">
              <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Files they attached</p>
              {files.map((f) => (
                <p key={f} className="text-[11px] text-cream/60 truncate" title={f}>{f}</p>
              ))}
              <p className="text-[10px] text-cream/30 mt-0.5">Open them in the Files tab.</p>
            </div>
          )}
        </div>

        {notes && (
          <div className="md:col-span-2">
            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Their notes</p>
            <p className="text-[11px] text-cream/70 whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        {styles.length === 0 && colors.length === 0 && rows.length === 0 && !notes && !finishNotes && files.length === 0 && (
          <p className="md:col-span-2 text-[11px] text-cream/35">
            This submission carried no preferences — it may predate the current form.
          </p>
        )}
      </div>
    </div>
  );
}
