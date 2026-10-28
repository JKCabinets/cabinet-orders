"use client";

/**
 * Submitted Website Preferences -- what the customer asked for on the quote
 * form, read-only (2026-10-28, item 8 step 4a; Garrett's mockup).
 *
 * THE MOCKUP'S THREE COLUMNS: chips for Preferred Door Styles, Preferred Colors
 * and Rooms Requested; Budget Range, Project Type and Timeline; the customer's
 * files and notes. VIEW FORM opens the WHOLE submission in place (Garrett):
 * contact, address, home type, design help, finish notes -- everything it
 * carried. Contact and address are on the details card already, so the summary
 * leaves them out; nothing is dropped, only folded.
 *
 * ⚠ ROOMS AND FILE KINDS COME FROM THE WEBSITE FORM, which sends them from
 * 2026-10-28's contract (docs: oms-to-website-rooms-and-file-kinds-2026-10-28.md):
 *   rooms / rooms_label        stored as choices.rooms, like door_style
 *   files_meta[].kind          "inspiration" | "layout"
 * Until it does, Rooms Requested is absent and the files are one "Files" list --
 * nothing is invented.
 *
 * A file chip OPENS THE FILE: the customer's uploads are on this job, filed in
 * "Customer uploads" with the name they were sent with. Matched by that name
 * from the same cached list the Files tab shows; one not found is plain text.
 *
 * Every shape is tolerated, as before: a null column, a string, no choices,
 * keys without labels (the key shows), numbers among labels, files_meta as text.
 */
import { useState } from "react";
import { ClipboardList, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";
import type { Order } from "@/lib/data";
import { useAttachments, downloadAttachment } from "@/lib/attachments";

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

type SentFile = { name: string; kind: string };

const LABEL = "text-[10px] uppercase tracking-[0.14em] text-cream/45 mb-1.5";
const CHIP = "px-2.5 py-0.5 rounded-full text-[11px] bg-white/5 border border-white/12 text-cream/80";

export function QuoteSubmissionPanel({ order }: { order: Order }) {
  // Hooks first: the panel may render nothing below.
  const list = useAttachments(order.id);
  const [full, setFull] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const raw = order.quote_submission;
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, Record<string, unknown> | unknown>;
  const choices = (doc.choices ?? {}) as Record<string, unknown>;
  const body = (doc.text ?? {}) as Record<string, unknown>;

  const styles = many(choices.door_style as MultiChoice);
  const colors = many(choices.color as MultiChoice);
  const rooms = many(choices.rooms as MultiChoice);
  const budget = one(choices.budget as Choice);
  const projectType = one(choices.project_type as Choice);
  const homeType = one(choices.home_type as Choice);
  const timeline = one(choices.timeline as Choice);
  const wantsDesignHelp = text(choices.design_assistance) === "yes";
  const notes = text(body.notes);
  const finishNotes = text(body.finish_notes);
  const files: SentFile[] = (Array.isArray(doc.files_meta) ? doc.files_meta : [])
    .map((f) => (f && typeof f === "object" ? { name: text((f as Record<string, unknown>).name), kind: text((f as Record<string, unknown>).kind) } : { name: "", kind: "" }))
    .filter((f) => f.name !== "");
  const inspiration = files.filter((f) => f.kind === "inspiration");
  const layout = files.filter((f) => f.kind === "layout");
  const otherFiles = files.filter((f) => f.kind !== "inspiration" && f.kind !== "layout");

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

  // The customer's own file on this job, by the name it was sent with.
  const uploaded = (list.files ?? []).filter((a) => a.kind === "customer_upload");
  const fileFor = (name: string) => uploaded.find((a) => a.file_name === name);
  async function open(name: string) {
    const a = fileFor(name);
    if (!a) return;
    setOpenError(null);
    const r = await downloadAttachment(a);
    if (!r.ok) setOpenError(`${name}: ${r.message}`);
  }

  const chips = (title: string, values: string[]) => values.length > 0 && (
    <div key={title}>
      <p className={LABEL}>{title}</p>
      <div className="flex flex-wrap gap-1.5">{values.map((v) => <span key={v} className={CHIP}>{v}</span>)}</div>
    </div>
  );
  const fact = (title: string, value: string) => value !== "" && (
    <div key={title}>
      <p className={LABEL}>{title}</p>
      <p className="text-[13px] text-cream/90">{value}</p>
    </div>
  );
  const fileChips = (title: string, list_: SentFile[]) => list_.length > 0 && (
    <div key={title}>
      <p className={LABEL}>{title}</p>
      <div className="flex flex-col gap-1.5">
        {list_.map((f) => {
          const found = !!fileFor(f.name);
          const Icon = /\.(png|jpe?g|gif|webp|heic)$/i.test(f.name) ? ImageIcon : /\.pdf$/i.test(f.name) ? FileText : FileIcon;
          return found ? (
            <button key={f.name} onClick={() => void open(f.name)} title={`Open ${f.name}`}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all hover:brightness-125 min-w-0"
              style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0 text-cream/60" />
              <span className="text-[11px] text-cream/85 truncate">{f.name}</span>
            </button>
          ) : (
            <span key={f.name} title="Not among this job's files" className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
              <Icon className="w-3.5 h-3.5 flex-shrink-0 text-cream/35" />
              <span className="text-[11px] text-cream/55 truncate">{f.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );

  const nothing = !styles.length && !colors.length && !rooms.length && !budget && !projectType && !timeline && !files.length && !notes;

  // The whole submission, for View Form.
  const row = (label: string, value: string) => value !== "" && (
    <div key={label} className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-cream/40">{label}</span>
      <span className="text-[11px] text-cream/80 text-right min-w-0 break-words">{value}</span>
    </div>
  );

  return (
    <div className="glass-sage rounded-panel px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(184,130,106,0.14)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
          <ClipboardList className="w-4 h-4" style={{ color: "#d9a888" }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-cream/90">Submitted Website Preferences</p>
          <p className="text-[11px] text-cream/50">
            Information collected from the customer’s website form submission{submittedLabel ? `, ${submittedLabel}` : ""}.
          </p>
        </div>
        <button onClick={() => setFull((v) => !v)} aria-expanded={full}
          className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
          {full ? "Hide form" : "View Form"}
        </button>
      </div>

      {nothing ? (
        <p className="mt-3 text-[11px] text-cream/40">This submission carried no preferences — it may predate the current form.</p>
      ) : (
        <div className="mt-3.5 grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-3">
          <div className="flex flex-col gap-3 min-w-0">
            {chips("Preferred Door Styles", styles)}
            {chips("Preferred Colors", colors)}
            {chips("Rooms Requested", rooms)}
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            {fact("Budget Range", budget)}
            {fact("Project Type", projectType)}
            {fact("Timeline", timeline)}
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            {fileChips("Inspiration Files", inspiration)}
            {fileChips("Layout Files", layout)}
            {fileChips(inspiration.length || layout.length ? "Other Files" : "Files", otherFiles)}
            {notes && (
              <div>
                <p className={LABEL}>Customer Notes</p>
                <p className="text-[12px] text-cream/80 italic whitespace-pre-wrap">“{notes}”</p>
              </div>
            )}
          </div>
        </div>
      )}
      {openError && <p role="alert" className="mt-2 text-[11px] text-red-400">{openError}</p>}

      {full && (
        <div role="region" aria-label="The full submission" className="mt-3.5 rounded-lg px-3 py-3 space-y-3"
          style={{ background: "rgba(255,255,255,0.025)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
          {(contactName || phone || email) && (
            <div className="space-y-1">
              <p className={LABEL}>Contact</p>
              {contactName && <p className="text-[12px] text-cream/85">{contactName}</p>}
              {row("Phone", phone)}
              {row("Email", email)}
            </div>
          )}
          {(address || budget || projectType || homeType || timeline || wantsDesignHelp) && (
            <div className="space-y-1">
              <p className={LABEL}>Project</p>
              {address && <p className="text-[12px] text-cream/85">{address}</p>}
              {row("Budget", budget)}
              {row("Project type", projectType)}
              {row("Home type", homeType)}
              {row("Timeline", timeline)}
              {wantsDesignHelp && <p className="text-[11px]" style={{ color: "#b8d0bd" }}>Asked for design assistance</p>}
            </div>
          )}
          {(styles.length > 0 || colors.length > 0 || rooms.length > 0 || finishNotes) && (
            <div className="space-y-2">
              <p className={LABEL}>Style and finish</p>
              {chips("Door styles", styles)}
              {chips("Colors", colors)}
              {chips("Rooms", rooms)}
              {finishNotes && (
                <div>
                  <p className={LABEL}>Finish notes</p>
                  <p className="text-[11px] text-cream/75 whitespace-pre-wrap">{finishNotes}</p>
                </div>
              )}
            </div>
          )}
          {(files.length > 0 || notes) && (
            <div className="space-y-1.5">
              <p className={LABEL}>Files and notes</p>
              {files.map((f) => (
                <p key={f.name} className="text-[11px] text-cream/70 truncate" title={f.name}>
                  {f.name}{f.kind ? ` · ${f.kind}` : ""}
                </p>
              ))}
              {notes && <p className="text-[11px] text-cream/75 whitespace-pre-wrap">{notes}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
