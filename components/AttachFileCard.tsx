"use client";

/**
 * "Attach a file" from the Next Action band (2026-10-27, item 8 step 5;
 * Garrett): a card directly BELOW the band that slides open, pushing the
 * Overview down; asks which group the file goes in (or a new one); uploads;
 * says what was attached where; then slides back up under the band and is gone.
 *
 * It replaced a question shown inside the Files pane, at the foot of the
 * Overview -- far from the button, so nothing seemed to happen -- and, when the
 * modal opened on a move that needed an attachment, inside the pane while it
 * was still HIDDEN, so nothing appeared at all.
 *
 * ⚠ THE FILE PICKER OPENS ONLY FROM A CLICK. Browsers (Safari most strictly)
 * open it only within the click that asked for it, never after waiting on the
 * server. So an existing group opens the picker at once; a NEW group is made
 * first and then offered as one more button -- "Choose a file for ...".
 *
 * Closed, the card is `inert`: its buttons cannot be reached by keyboard or a
 * screen reader. The slide honours reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import { Paperclip, X, Loader2, Check, FolderPlus } from "lucide-react";
import { useAttachments, uploadAttachment, createFileGroup } from "@/lib/attachments";

type Target = { id: number; name: string };

const CHOICE = "text-[12px] px-3 py-1.5 rounded-full transition-all bg-white/5 border border-cream/20 text-cream/85 hover:bg-white/10 hover:text-cream disabled:opacity-40";
const FIELD_STYLE: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.14)", color: "rgba(240,236,228,0.90)", fontSize: "16px" };

export function AttachFileCard({ orderId, open, onClose }: { orderId: string; open: boolean; onClose: () => void }) {
  const list = useAttachments(orderId);
  const groups = list.groups ?? [];
  const [phase, setPhase] = useState<"choose" | "uploading" | "done">("choose");
  const [made, setMade] = useState<Target | null>(null);        // a group just made, awaiting its click
  const [newName, setNewName] = useState("");
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const [doneText, setDoneText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const target = useRef<Target | null>(null);

  // Every opening starts afresh.
  useEffect(() => {
    if (!open) return;
    setPhase("choose"); setMade(null); setNewName(""); setError(""); setDoneText("");
  }, [open]);

  // After a success: a moment to read it, then slide away.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  const pick = (t: Target) => { target.current = t; inputRef.current?.click(); };

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const t = target.current;
    if (files.length === 0 || !t) return;
    setPhase("uploading");
    setError("");
    const refused: string[] = [];
    const attached: string[] = [];
    for (const f of files) {
      const r = await uploadAttachment(orderId, f, "general", t.id);
      if (r.ok) attached.push(f.name); else refused.push(r.message);
    }
    if (attached.length === 0) { setError(refused.join(" · ")); setPhase("choose"); return; }
    setDoneText(`${attached.length === 1 ? attached[0] : `${attached.length} files`} attached to “${t.name}”.`
      + (refused.length ? ` Not attached: ${refused.join(" · ")}` : ""));
    setPhase("done");
  }

  async function makeGroup(e: React.FormEvent) {
    e.preventDefault();
    setMaking(true);
    setError("");
    const r = await createFileGroup(orderId, newName);
    setMaking(false);
    if (!r.ok) { setError(r.message); return; }
    setMade({ id: r.value.id, name: r.value.name });
    setNewName("");
  }

  return (
    <div aria-hidden={!open} inert={!open}
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
      <div className="overflow-hidden min-h-0">
        <div className="pt-2.5">
          <div role="region" aria-label="Attach a file" className="glass-sage rounded-panel px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(184,130,106,0.14)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
                {phase === "done" ? <Check className="w-4 h-4" style={{ color: "#a9cf8f" }} /> : <Paperclip className="w-4 h-4" style={{ color: "#d9a888" }} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-cream/90">Attach a file</p>
                {phase === "done" ? (
                  <p role="status" className="text-[12px] text-cream/70 mt-0.5">{doneText}</p>
                ) : phase === "uploading" ? (
                  <p role="status" className="text-[12px] text-cream/70 mt-0.5 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Uploading to “{target.current?.name}”…
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] text-cream/65 mt-0.5">
                      {groups.length ? "Which group should it go in?" : "This order has no file groups yet — name one to put it in."}
                    </p>
                    {error && <p role="alert" className="text-[11px] mt-1.5" style={{ color: "#e08585" }}>{error}</p>}
                    {made ? (
                      <div className="mt-2.5">
                        <button onClick={() => pick(made)} className={CHOICE + " flex items-center gap-1.5"}>
                          <Paperclip className="w-3 h-3" /> Choose a file for “{made.name}”
                        </button>
                      </div>
                    ) : (
                      <>
                        {groups.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {groups.map((g) => (
                              <button key={g.id} onClick={() => pick({ id: g.id, name: g.name })} className={CHOICE}>{g.name}</button>
                            ))}
                          </div>
                        )}
                        <form onSubmit={(e) => void makeGroup(e)} className="flex items-center gap-2 mt-2.5">
                          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80}
                            placeholder={groups.length ? "Or a new group…" : "e.g. Acknowledgments"}
                            aria-label="A new group for the file"
                            className="flex-1 min-w-0 rounded-brand px-2.5 py-1.5 placeholder:text-cream/25" style={FIELD_STYLE} />
                          <button type="submit" disabled={making || !newName.trim()} className={CHOICE + " flex items-center gap-1.5"}>
                            {making ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />} Create group
                          </button>
                        </form>
                      </>
                    )}
                  </>
                )}
              </div>
              <button onClick={onClose} title="Close" aria-label="Close" className="p-1 text-cream/50 hover:text-cream"><X className="w-3.5 h-3.5" /></button>
            </div>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e)}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
          </div>
        </div>
      </div>
    </div>
  );
}
