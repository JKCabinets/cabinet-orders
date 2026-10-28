"use client";

/**
 * The Files tab -- FILE GROUPS (2026-10-27, item 8 step 5; Garrett, 2026-10-26).
 *
 * Groups belong to this order and are named by people; a file is uploaded INTO
 * a group, so a group exists first. Each group is a section: its files, its
 * Upload, and -- for groups people may change -- Rename and Delete. Deleting a
 * group deletes its files, after a prompt that says so (and says so again if it
 * holds the signed delivery receipt the Delivered gate reads).
 *
 * The OMS makes "Customer uploads" (the quote form, a promoted claim) and "Proof
 * of delivery" (a receipt) and finds them by ROLE -- ordinary groups people may
 * rename or delete. A custom job's rooms and style groups have groups that
 * FOLLOW the room: renamed and deleted through Custom Job Specs, not here.
 *
 * ⚠ kind IS NOT THE GROUP. A receipt stays a receipt wherever it is filed, and
 * the gates read `kind`; a receipt or a customer's file never goes into a
 * room's group (the server refuses it; this does not offer it).
 *
 * Kept from the tab this replaces: the Receipt upload (filed by the server),
 * read-only orders, download, delete with its confirm, every error and Retry,
 * and the receipt picker the Next Action band calls. Its "Attach a file" is the
 * AttachFileCard under the band (2026-10-27): asked here, at the foot of the
 * Overview, nothing seemed to happen.
 * Changed: rows sit on the OMS's surface, not #111, and their actions are
 * always shown, not only on hover.
 */
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Paperclip, Upload, X, Download, FileText, Image, File, Loader2, Trash2, FileCheck, RotateCcw, FolderPlus, Pencil } from "lucide-react";
import type { OrderType, CustomSpecs } from "@/lib/data";
import { typeEverRequires } from "@/lib/requirements";
import { AckFileMark, AckInUseNote } from "./AckFileMark";
import {
  useAttachments, uploadAttachment, deleteAttachment, downloadAttachment, refreshAttachments,
  createFileGroup, renameFileGroup, deleteFileGroup, moveAttachment, followsRoom,
  type Attachment, type FileGroup,
} from "@/lib/attachments";

interface AttachmentsPanelProps {
  orderId: string;
  /** Decides whether a signed receipt is offered at all. */
  orderType: OrderType;
  /** Archived, or somebody else's claim: everything readable, nothing changeable. */
  readOnly?: boolean;
  /** No longer read: a room's files are filed in its group (2026-10-27). Kept so callers need not change. */
  specs?: CustomSpecs | null;
  /**
   * Open AT this group (2026-10-28, 5d): an Overview tile scrolls the Files tab
   * to its section and highlights it a moment. `focusKey` changes on every
   * request, so asking for the same group twice still scrolls.
   */
  focusGroupId?: number | null;
  focusKey?: number;
}

export interface AttachmentsPanelHandle {
  /** The Next Action band's "Upload receipt": straight to the picker; the server files a receipt by role.
   *  ("Attach a file" is the AttachFileCard under the band, since 2026-10-27.) */
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

const PILL = "flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cream/18 bg-white/4 text-[11px] uppercase tracking-wider text-cream/75 hover:bg-white/8 hover:text-cream transition-all disabled:opacity-40 disabled:cursor-not-allowed";
const SMALL = "text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream disabled:opacity-40";
const FIELD = "rounded-brand px-2.5 py-1.5 text-[16px] placeholder:text-cream/25 min-w-0";
const FIELD_STYLE: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.14)", color: "rgba(240,236,228,0.90)" };
/** A group's section id: the Overview's group tiles open the Files tab at it (step 5d). */
export const fileGroupAnchor = (groupId: number) => `file-group-${groupId}`;

export const AttachmentsPanel = forwardRef<AttachmentsPanelHandle, AttachmentsPanelProps>(
  function AttachmentsPanel({ orderId, orderType, readOnly = false, focusGroupId = null, focusKey }, ref) {
  const list = useAttachments(orderId);
  const attachments: Attachment[] = list.files ?? [];
  const groups: FileGroup[] = list.groups ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [newName, setNewName] = useState<string | null>(null);          // the New group field, when open
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [confirmGroupId, setConfirmGroupId] = useState<number | null>(null);
  // "Which group?" for the Next Action band is asked in AttachFileCard, under the band (2026-10-27).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const uploadTo = useRef<number | null>(null);

  const receiptOffered = !readOnly && typeEverRequires(orderType, "proof_of_delivery");

  // Open at a group: once its section exists, scroll to it and light it up.
  const [highlight, setHighlight] = useState<number | null>(null);
  const groupsLoaded = list.groups !== null;
  useEffect(() => {
    if (focusGroupId === null || !groupsLoaded) return;
    document.getElementById(fileGroupAnchor(focusGroupId))?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(focusGroupId);
    const t = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(t);
  }, [focusGroupId, focusKey, groupsLoaded]);
  const filesIn = (g: FileGroup) => attachments.filter((a) => a.group_id === g.id);
  // ⚠ A FILE IN NO GROUP can exist only between phase A and the deploy (the old
  // code uploading without one). Shown, so it can be filed -- phase B refuses
  // while any remain, and an unseen file could not be.
  const known = new Set(groups.map((g) => g.id));
  const loose = attachments.filter((a) => a.group_id === null || !known.has(a.group_id));
  const pick = (groupId: number) => { uploadTo.current = groupId; fileInputRef.current?.click(); };

  useImperativeHandle(ref, () => ({
    openReceiptPicker: () => receiptInputRef.current?.click(),
  }), []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "general" | "proof_of_delivery") {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    const groupId = kind === "general" ? uploadTo.current : null;
    uploadTo.current = null;
    if (kind === "general" && groupId === null) { setError("Choose a group to upload into."); return; }
    setBusy(true);
    setError("");
    const refused: string[] = [];
    for (const file of files) {
      const r = await uploadAttachment(orderId, file, kind, groupId);
      if (!r.ok) refused.push(r.message);
    }
    setBusy(false);
    if (refused.length) setError((files.length > 1 ? `${files.length - refused.length} of ${files.length} uploaded. ` : "") + refused.join(" · "));
  }

  async function handleDownload(a: Attachment) {
    setDownloadingId(a.id);
    const r = await downloadAttachment(a);
    setDownloadingId(null);
    if (!r.ok) setError(`${a.file_name}: ${r.message}`);
  }

  async function handleDelete(a: Attachment) {
    setConfirmDeleteId(null);
    setDeletingId(a.id);
    const r = await deleteAttachment(orderId, a.id);
    setDeletingId(null);
    if (!r.ok) setError(`${a.file_name} was not deleted: ${r.message}`);
  }

  async function handleMove(a: Attachment, groupId: number) {
    setMovingId(a.id);
    const r = await moveAttachment(orderId, a.id, groupId);
    setMovingId(null);
    if (!r.ok) setError(`${a.file_name} was not moved: ${r.message}`);
  }

  async function makeGroup(name: string): Promise<FileGroup | null> {
    setBusy(true);
    setError("");
    const r = await createFileGroup(orderId, name);
    setBusy(false);
    if (!r.ok) { setError(r.message); return null; }
    return r.value;
  }

  async function handleRename() {
    if (!renaming) return;
    setBusy(true);
    const r = await renameFileGroup(orderId, renaming.id, renaming.name);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setRenaming(null);
  }

  async function handleDeleteGroup(g: FileGroup) {
    setConfirmGroupId(null);
    setBusy(true);
    const r = await deleteFileGroup(orderId, g.id);
    setBusy(false);
    if (!r.ok) setError(`“${g.name}” was not deleted: ${r.message}`);
  }

  /** Where a file may move: any other group, but never a room's for a receipt or a customer's file. */
  const movesFor = (a: Attachment) => groups.filter((g) => g.id !== a.group_id && (a.kind === "general" || !followsRoom(g)));

  /** One file's row -- the same in a group and in "Not in a group". */
  const fileRow = (a: Attachment) => (

                      <div key={a.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
                        <FileIcon type={a.file_type} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-[#e8e3da] truncate">{a.file_name}</p>
                            {a.kind === "acknowledgment" && (
                              <span className="flex-shrink-0 text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full bg-[rgba(184,130,106,0.14)] border border-[rgba(184,130,106,0.40)] text-[#d9a888]">acknowledgment</span>
                            )}
                            {a.kind === "acknowledgment" && <AckFileMark orderId={orderId} attachmentId={a.id} />}
                            {a.kind === "proof_of_delivery" && (
                              <span className="flex-shrink-0 text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full bg-[rgba(143,190,112,0.14)] border border-[rgba(143,190,112,0.40)] text-[#a9cf8f]">receipt</span>
                            )}
                          </div>
                          <p className="text-[10px] text-[rgba(232,227,218,0.40)]">
                            {formatBytes(a.file_size)} · {a.uploaded_by} · {formatDay(a.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {deletingId === a.id || movingId === a.id ? (
                            <Loader2 className="w-3 h-3 animate-spin text-[rgba(232,227,218,0.50)]" />
                          ) : confirmDeleteId === a.id ? (
                            <>
                              {a.kind === "acknowledgment" && <AckInUseNote orderId={orderId} attachmentId={a.id} />}
                              <button onClick={() => void handleDelete(a)} className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded border border-red-900/50">Delete</button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] px-1.5 py-0.5 rounded border border-white/10">Cancel</button>
                            </>
                          ) : (
                            <>
                              {!readOnly && movesFor(a).length > 0 && (
                                <select aria-label={`Move ${a.file_name} to`} value=""
                                  onChange={(e) => { const to = Number(e.target.value); if (to) void handleMove(a, to); }}
                                  className="text-[10px] rounded px-1 py-0.5 max-w-[9rem]" style={FIELD_STYLE}>
                                  <option value="">Move to…</option>
                                  {movesFor(a).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                              )}
                              <button onClick={() => void handleDownload(a)} disabled={downloadingId === a.id} title="Download"
                                className="p-1 text-[rgba(232,227,218,0.55)] hover:text-[#e8e3da] transition-colors">
                                {downloadingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              </button>
                              {!readOnly && (
                                <button onClick={() => setConfirmDeleteId(a.id)} title="Delete"
                                  className="p-1 text-[rgba(232,227,218,0.55)] hover:text-red-400 transition-colors">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
  );

  const firstLoad = list.files === null;

  return (
    <div className="px-6 py-5 border-b border-white/10">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.16em] text-cream/50 font-medium">
          Files {attachments.length > 0 && <span className="text-cream/65 ml-1">({attachments.length})</span>}
        </p>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            {receiptOffered && (
              <button onClick={() => receiptInputRef.current?.click()} disabled={busy}
                title="Signed delivery receipt — required before this order can be marked Delivered. Filed in Proof of delivery."
                className={PILL}>
                <FileCheck className="w-3 h-3" /> Receipt
              </button>
            )}
            <button onClick={() => setNewName(newName === null ? "" : null)} disabled={busy} className={PILL}>
              <FolderPlus className="w-3 h-3" /> New group
            </button>
          </div>
        )}
        {!readOnly && (
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={(e) => void handleUpload(e, "general")}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
        )}
        {receiptOffered && (
          <input ref={receiptInputRef} type="file" multiple className="hidden"
            onChange={(e) => void handleUpload(e, "proof_of_delivery")} accept="image/*,.pdf" />
        )}
      </div>

      {newName !== null && !readOnly && (
        <form className="flex items-center gap-2 mb-3"
          onSubmit={async (e) => { e.preventDefault(); if (await makeGroup(newName)) setNewName(null); }}>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80}
            placeholder="Group name, e.g. Drawings" aria-label="New group name" className={FIELD + " flex-1"} style={FIELD_STYLE} />
          <button type="submit" disabled={busy || !newName.trim()} className={SMALL}>Create</button>
          <button type="button" onClick={() => setNewName(null)} className={SMALL}>Cancel</button>
        </form>
      )}

      {/* The Next Action band's "Attach a file" asks which group in the
          AttachFileCard under the band (2026-10-27): asked here, at the foot
          of the Overview, nothing seemed to happen. */}
      {error && (
        <div className="flex items-start justify-between gap-2 mb-2 px-2.5 py-1.5 bg-red-950/30 border border-red-900/50 rounded-lg">
          <p role="alert" className="text-[11px] text-red-400">{error}</p>
          <button onClick={() => setError("")} title="Dismiss"><X className="w-3 h-3 text-red-400" /></button>
        </div>
      )}
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

      {firstLoad ? (
        list.error ? null : (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-[rgba(232,227,218,0.30)]" />
          </div>
        )
      ) : groups.length === 0 && loose.length === 0 ? (
        <p className="text-[11px] text-[rgba(232,227,218,0.40)] py-3">
          {readOnly ? "No files on this order." : "No groups yet. Make one — “Drawings”, “Measurements” — and attach files to it."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const inIt = filesIn(g);
            const holdsReceipt = inIt.some((a) => a.kind === "proof_of_delivery");
            const changeable = !readOnly && !followsRoom(g);
            return (
              <section key={g.id} id={fileGroupAnchor(g.id)} aria-label={g.name} className="rounded-lg px-3 py-2.5 transition-[border-color,box-shadow] duration-500"
                data-highlighted={highlight === g.id ? "" : undefined}
                style={{ background: "rgba(255,255,255,0.025)", border: `0.5px solid ${highlight === g.id ? "rgba(217,168,136,0.75)" : "rgba(255,255,255,0.10)"}`,
                  boxShadow: highlight === g.id ? "0 0 0 2px rgba(217,168,136,0.25)" : "none" }}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {renaming?.id === g.id ? (
                    <form className="flex items-center gap-2 flex-1" onSubmit={(e) => { e.preventDefault(); void handleRename(); }}>
                      <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} maxLength={80}
                        aria-label={`Rename ${g.name}`} className={FIELD + " flex-1"} style={FIELD_STYLE} />
                      <button type="submit" disabled={busy || !renaming.name.trim()} className={SMALL}>Save</button>
                      <button type="button" onClick={() => setRenaming(null)} className={SMALL}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <p className="text-[12px] font-medium text-cream/90">{g.name}</p>
                      <span className="text-[10px] text-cream/45">{inIt.length} file{inIt.length === 1 ? "" : "s"}</span>
                      {followsRoom(g) && <span className="text-[10px] text-cream/35" title="Renamed and deleted with its room, in Custom Job Specs">· follows its room</span>}
                      <div className="ml-auto flex items-center gap-1.5">
                        {!readOnly && (
                          <button onClick={() => pick(g.id)} disabled={busy} className={SMALL + " flex items-center gap-1"}>
                            <Upload className="w-2.5 h-2.5" /> Upload
                          </button>
                        )}
                        {changeable && (
                          <>
                            <button onClick={() => setRenaming({ id: g.id, name: g.name })} disabled={busy} title="Rename" className={SMALL + " flex items-center gap-1"}>
                              <Pencil className="w-2.5 h-2.5" /> Rename
                            </button>
                            <button onClick={() => setConfirmGroupId(g.id)} disabled={busy} title="Delete the group and its files" className={SMALL + " flex items-center gap-1"}>
                              <Trash2 className="w-2.5 h-2.5" /> Delete
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {confirmGroupId === g.id && (
                  <div role="alertdialog" aria-label={`Delete ${g.name}?`} className="mb-2 px-2.5 py-2 rounded-lg bg-red-950/30 border border-red-900/50">
                    <p className="text-[11px] text-red-300">
                      {inIt.length > 0
                        ? <>Delete “{g.name}” and its {inIt.length} file{inIt.length === 1 ? "" : "s"}? The files are deleted with it {"—"} move any you want to keep to another group first.</>
                        : <>Delete the empty group “{g.name}”?</>}
                    </p>
                    {holdsReceipt && (
                      <p className="text-[11px] text-red-300 mt-1">
                        It holds the signed delivery receipt: deleting it means the order needs a new receipt before it can be delivered.
                      </p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => void handleDeleteGroup(g)} className="text-[10px] text-red-300 hover:text-red-200 px-2 py-0.5 rounded border border-red-900/60">
                        Delete group{inIt.length > 0 ? " and files" : ""}
                      </button>
                      <button onClick={() => setConfirmGroupId(null)} className="text-[10px] text-cream/60 hover:text-cream px-2 py-0.5 rounded border border-white/15">Cancel</button>
                    </div>
                  </div>
                )}

                {inIt.length === 0 ? (
                  readOnly ? (
                    <p className="text-[11px] text-[rgba(232,227,218,0.30)] py-1">Nothing in this group.</p>
                  ) : (
                    <button onClick={() => pick(g.id)} className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-3 flex flex-col items-center gap-1 hover:border-[rgba(255,255,255,0.20)] transition-colors group">
                      <Paperclip className="w-3.5 h-3.5 text-[rgba(232,227,218,0.30)] group-hover:text-[rgba(232,227,218,0.50)]" />
                      <span className="text-[11px] text-[rgba(232,227,218,0.35)] group-hover:text-[rgba(232,227,218,0.55)]">Click to attach files to {g.name}</span>
                      <span className="text-[10px] text-cream/25">PDF, images, docs up to 20MB</span>
                    </button>
                  )
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {inIt.map(fileRow)}
                  </div>
                )}
              </section>
            );
          })}
          {loose.length > 0 && (
            <section aria-label="Not in a group" className="rounded-lg px-3 py-2.5"
              style={{ background: "rgba(232,181,106,0.05)", border: "0.5px solid rgba(232,181,106,0.30)" }}>
              <p className="text-[12px] font-medium text-cream/90 mb-0.5">Not in a group</p>
              <p className="text-[10px] text-cream/45 mb-2">Uploaded before file groups. Move each into a group.</p>
              <div className="flex flex-col gap-1.5">{loose.map(fileRow)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
});
