"use client";

import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Paperclip, Upload, X, Download, FileText, Image, File, Loader2, Trash2, FileCheck, RotateCcw } from "lucide-react";
import { readCustomSpecs, attachmentBin, type OrderType, type CustomSpecs, type AttachmentBin } from "@/lib/data";
import { typeEverRequires } from "@/lib/requirements";
import {
  useAttachments, uploadAttachment, deleteAttachment, attachmentUrl, refreshAttachments,
  type Attachment,
} from "@/lib/attachments";

interface AttachmentsPanelProps {
  orderId: string;
  /** Decides whether a signed receipt is offered at all -- see `receiptOffered`. */
  orderType: OrderType;
  /**
   * Show the files, offer nothing. The modal sets it for an ARCHIVED row and
   * for a row CLAIMED BY SOMEONE ELSE (unless an admin chose to edit it) --
   * every write route refuses both anyway, 409 `archived_read_only` or
   * `claimed_by_other`. Until 2026-09-30 it was archived only, so a colleague
   * saw Upload and Delete on somebody else's order and was refused after the
   * fact. The list, the names, the dates and the downloads stay.
   */
  readOnly?: boolean;
  /**
   * A custom job's specifications: each ROOM gets its own bin, and uploading in
   * it files the upload under that room. Omit it (every other type) and there
   * are two bins, as before.
   */
  specs?: CustomSpecs | null;
}

/**
 * Imperative handle exposed by AttachmentsPanel. Parent components can call
 * `ref.current?.openFilePicker()` to programmatically open the OS file
 * picker — used when the modal opens because of a missing-attachment gate
 * failure and we want to land the user directly on "add a file".
 *
 * Both are no-ops when the panel offers nothing: read-only, or -- for the
 * receipt -- a type that never needs one. Every caller in the modal already
 * appears only where both hold.
 */
export interface AttachmentsPanelHandle {
  openFilePicker: () => void;
  /** Opens the picker that uploads as proof_of_delivery. Used by the
   *  delivery gate to land the user on the right action. */
  openReceiptPicker: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <Image className="w-3.5 h-3.5 text-blue-400" />;
  if (type === "application/pdf") return <FileText className="w-3.5 h-3.5 text-red-400" />;
  return <File className="w-3.5 h-3.5 text-[rgba(232,227,218,0.50)]" />;
}

/**
 * The order's files, in bins, with upload and delete.
 *
 * ⚠ THE LIST IS SHARED (lib/attachments, 2026-09-30). Every view reads one
 * list, so an upload or a delete in either shows in both, and a delete leaves
 * the screen only when the server has done it.
 *
 * ⚠ ON A CUSTOM JOB THIS IS ALSO THE FILES TAB, with a bin per room -- the same
 * component in both places, so the bins cannot drift apart.
 */
export const AttachmentsPanel = forwardRef<AttachmentsPanelHandle, AttachmentsPanelProps>(
  function AttachmentsPanel({ orderId, orderType, readOnly = false, specs = null }, ref) {
  const list = useAttachments(orderId);
  const attachments: Attachment[] = list.files ?? [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [bin, setBin] = useState<AttachmentBin>("designer");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // ⚠ THE RECEIPT FOLLOWS THE REQUIREMENTS TABLE, like every other control that
  // stands for a requirement. Only a cabinet group ever needs a signed proof of
  // delivery (Terms 12.3). Until 2026-09-30 the button was offered on every
  // type, with a title saying it was "required before this order can be marked
  // Delivered" -- on a custom job, which has no gates at all, that was a demand
  // nothing enforces. A receipt uploaded before this keeps its badge.
  const receiptOffered = !readOnly && typeEverRequires(orderType, "proof_of_delivery");

  // ⚠ THE BINS (2026-10-01, Garrett: the same bins wherever files are shown).
  // Designer, Customer, then one per ROOM of a custom job, in the job's order.
  // attachmentBin in lib/data decides which bin a file is in, for this panel and
  // for the custom job's Files tab -- which IS this panel -- so a label cannot
  // mean two sets of files. Designer is the job's own: anything not the
  // customer's and not filed under a room that exists, which includes a file
  // whose room was removed.
  const rooms = specs ? readCustomSpecs(specs).areas : [];
  const readSpecs = { v: 2 as const, areas: rooms };
  type BinDef = { key: AttachmentBin; label: string; specRef: string | null; uploads: boolean };
  const bins: BinDef[] = [
    { key: "designer", label: "Designer attachments", specRef: null, uploads: true },
    { key: "customer", label: "Customer attachments", specRef: null, uploads: false },
    ...rooms.map((r): BinDef => ({ key: `room:${r.id}`, label: r.name.trim() || "Untitled room", specRef: r.id, uploads: true })),
  ];
  const placed = attachments.map((a) => ({ a, ...attachmentBin(a, readSpecs) }));
  // A room removed elsewhere takes its bin with it: fall back to Designer.
  const current = bins.find((b) => b.key === bin) ?? bins[0];
  const shown = placed.filter((p) => p.bin === current.key);
  const count = (k: AttachmentBin) => placed.filter((p) => p.bin === k).length;
  const setName = (setId?: string) =>
    setId ? rooms.flatMap((r) => r.sets).find((s) => s.id === setId)?.name.trim() || "a style group" : null;

  // ⚠ WHERE AN UPLOAD IS FILED is decided when the picker opens, not when the
  // file arrives. The panel's own buttons file under the bin on screen; the
  // modal's calls through the handle -- a work-queue row asking for "a file" --
  // always file under the job, whichever bin was last clicked.
  const uploadTo = useRef<string | null>(null);
  const pick = (specRef: string | null) => { uploadTo.current = specRef; fileInputRef.current?.click(); };

  useImperativeHandle(ref, () => ({
    openFilePicker: () => { uploadTo.current = null; fileInputRef.current?.click(); },
    openReceiptPicker: () => receiptInputRef.current?.click(),
  }), []);

  async function handleUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "general" | "proof_of_delivery" = "general",
  ) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    // ⚠ EVERY REFUSAL IS KEPT. One message per file that did not go, in the
    // route's own words; the ones that did go are in the list.
    const refused: string[] = [];
    const specRef = kind === "general" ? uploadTo.current : null;
    // Read once, then forgotten: the next upload is the job's unless whatever
    // opens its picker says otherwise. A target never carries over.
    uploadTo.current = null;
    for (const file of files) {
      const r = await uploadAttachment(orderId, file, kind, specRef);
      if (!r.ok) refused.push(r.message);
    }
    setUploading(false);
    if (refused.length) {
      setError((files.length > 1 ? `${files.length - refused.length} of ${files.length} uploaded. ` : "") + refused.join(" · "));
    }
  }

  async function handleDownload(attachment: Attachment) {
    setDownloadingId(attachment.id);
    const r = await attachmentUrl(attachment.id);
    setDownloadingId(null);
    if (!r.ok) { setError(`${attachment.file_name}: ${r.message}`); return; }
    const a = document.createElement("a");
    a.href = r.value;
    a.download = attachment.file_name;
    a.target = "_blank";
    a.click();
  }

  async function handleDelete(att: Attachment) {
    setConfirmDeleteId(null);
    setDeletingId(att.id);
    const r = await deleteAttachment(orderId, att.id);
    setDeletingId(null);
    if (!r.ok) setError(`${att.file_name} was not deleted: ${r.message}`);
  }

  const firstLoad = list.files === null;

  return (
    <div className="px-6 py-5 border-b border-white/10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-cream/50 font-medium">
          Attachments {attachments.length > 0 && <span className="text-cream/65 ml-1">({attachments.length})</span>}
        </p>
        {!readOnly && (
        <div className="flex items-center gap-1.5">
          {receiptOffered && (
            <button
              onClick={() => receiptInputRef.current?.click()}
              disabled={uploading}
              title="Signed delivery receipt — required before this order can be marked Delivered"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cream/18 bg-white/4 text-[11px] uppercase tracking-wider text-cream/85 hover:bg-white/8 hover:border-terracotta/40 transition-all disabled:opacity-50"
            >
              <FileCheck className="w-3 h-3" /> Receipt
            </button>
          )}
          <button
            onClick={() => pick(current.specRef)}
            disabled={uploading}
            title={current.specRef ? `Files uploaded here are filed under ${current.label}` : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cream/18 bg-white/4 text-[11px] uppercase tracking-wider text-cream/85 hover:bg-white/8 hover:border-terracotta/40 transition-all disabled:opacity-50"
          >
            {uploading ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-3 h-3" /> {current.specRef ? `Upload to ${current.label}` : "Upload"}</>
            )}
          </button>
        </div>
        )}
        {!readOnly && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e, "general")}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          />
        )}
        {receiptOffered && (
          <input
            ref={receiptInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e, "proof_of_delivery")}
            accept="image/*,.pdf"
          />
        )}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 mb-2 px-2.5 py-1.5 bg-red-950/30 border border-red-900/50 rounded-lg">
          <p className="text-[11px] text-red-400">{error}</p>
          <button onClick={() => setError("")} title="Dismiss"><X className="w-3 h-3 text-red-400" /></button>
        </div>
      )}

      {/* ⚠ A FAILED LOAD SAYS SO. It used to read as "No files on this order". */}
      {list.error && (
        <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 bg-red-950/30 border border-red-900/50 rounded-lg">
          <p className="text-[11px] text-red-400">
            {firstLoad ? "The files could not be loaded" : "The list may be out of date"}: {list.error}
          </p>
          <button onClick={() => refreshAttachments(orderId)} title="Try again" className="flex items-center gap-1 text-[10px] text-red-300 hover:text-red-200">
            <RotateCcw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* ⚠ THE BINS, BY WHO PUT THE FILE THERE AND WHERE IT IS FILED. Customer
          uploads arrive with a quote request and are never added here; the
          designer's own files are the ones staff add, under the job or under a
          room. A receipt keeps its own badge inside Designer; the delivery gate
          reads `kind`, not this tab. Room bins show even when empty: an empty
          room is where its first drawing goes. */}
      {!firstLoad && (attachments.length > 0 || rooms.length > 0) && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {bins.map((b) => (
            <button
              key={b.key}
              onClick={() => setBin(b.key)}
              className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider transition-all border ${
                current.key === b.key
                  ? "bg-white/10 border-cream/25 text-cream"
                  : "bg-white/4 border-white/10 text-cream/55 hover:text-cream/80"
              }`}
            >
              {b.label} <span className="opacity-65 ml-1">{count(b.key)}</span>
            </button>
          ))}
        </div>
      )}

      {firstLoad ? (
        list.error ? null : (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-[rgba(232,227,218,0.30)]" />
          </div>
        )
      ) : shown.length === 0 ? (
        readOnly || !current.uploads ? (
          <p className="text-[11px] text-[rgba(232,227,218,0.30)] py-3">
            {current.key === "customer" ? "The customer attached nothing."
              : current.specRef ? `Nothing filed under ${current.label}.` : "No files on this order."}
          </p>
        ) : (
        <button
          onClick={() => pick(current.specRef)}
          className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-4 flex flex-col items-center gap-1.5 hover:border-[rgba(86,100,72,0.55)] transition-colors group"
        >
          <Paperclip className="w-4 h-4 text-[rgba(232,227,218,0.30)] group-hover:text-[rgba(232,227,218,0.50)] transition-colors" />
          <span className="text-[11px] text-[rgba(232,227,218,0.30)] group-hover:text-[rgba(232,227,218,0.50)] transition-colors">
            {current.specRef ? `Click to attach files to ${current.label}` : "Click to attach files"}
          </span>
          <span className="text-[10px] text-[#3e3e3e]">PDF, images, docs up to 20MB</span>
        </button>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map(({ a: att, setId }) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg group hover:border-[rgba(86,100,72,0.55)] transition-colors"
            >
              <FileIcon type={att.file_type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-[#e8e3da] truncate">{att.file_name}</p>
                  {att.kind === "proof_of_delivery" && (
                    <span className="flex-shrink-0 text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full bg-[rgba(143,190,112,0.14)] border border-[rgba(143,190,112,0.40)] text-[#8fbe70]">
                      receipt
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[rgba(232,227,218,0.30)]">
                  {formatBytes(att.file_size)} · {att.uploaded_by} · {formatDay(att.created_at)}
                  {setName(setId) && <> · {setName(setId)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {deletingId === att.id ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[rgba(232,227,218,0.50)]" />
                ) : confirmDeleteId === att.id ? (
                  <>
                    <button onClick={() => void handleDelete(att)} className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded border border-red-900/50 transition-colors">Delete</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.10)] transition-colors">Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => void handleDownload(att)}
                      disabled={downloadingId === att.id}
                      title="Download"
                      className="p-1 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors"
                    >
                      {downloadingId === att.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    </button>
                    {!readOnly && (
                      <button
                        onClick={() => setConfirmDeleteId(att.id)}
                        title="Delete"
                        className="p-1 text-[rgba(232,227,218,0.50)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
