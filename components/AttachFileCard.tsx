"use client";

/**
 * "Attach a file" from the Next Action band -- the acknowledgment-or-attachment
 * requirement (Garrett, 2026-10-27/28).
 *
 * ⚠ IT ASKS NOTHING. The file goes in the order's "Acknowledgments" group, made
 * by the OMS and found by role (the upload route's group_role). The band's
 * button calls pick(), which opens the file picker WITHIN THAT CLICK -- a
 * browser opens one only there, never after waiting on the server (Safari most
 * strictly) -- and the group is found or made when the file is uploaded.
 *
 * The card is only the feedback: directly under the band it slides open with
 * "Uploading to Acknowledgments", says what was attached, then slides away by
 * itself. A refusal keeps it open, with the reason and Choose a file. Opened
 * WITHOUT a click (the modal opening on a move that needed a file) it offers
 * that one button, since no picker can open by itself.
 *
 * Closed, it is `inert`; the slide honours reduced motion.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Paperclip, X, Loader2, Check } from "lucide-react";
import { uploadAttachment } from "@/lib/attachments";

export interface AttachFileCardHandle {
  /** Open the file picker -- call it straight from a click. */
  pick: () => void;
}

/** What the card attaches (2026-10-28, 5d): "Attach a file", or a signed receipt. */
export type AttachPurpose = "acknowledgment" | "receipt";
const BUTTON = "text-[12px] px-3 py-1.5 rounded-full transition-all bg-white/5 border border-cream/20 text-cream/85 hover:bg-white/10 hover:text-cream flex items-center gap-1.5";

export const AttachFileCard = forwardRef<AttachFileCardHandle, { orderId: string; open: boolean; onOpenChange: (open: boolean) => void; purpose?: AttachPurpose }>(
  function AttachFileCard({ orderId, open, onOpenChange, purpose = "acknowledgment" }, ref) {
  // ⚠ A RECEIPT IS FILED BY THE SERVER, by its kind, in "Proof of delivery";
  // an acknowledgment-or-attachment goes in "Acknowledgments" by role.
  const GROUP = purpose === "receipt" ? "Proof of delivery" : "Acknowledgments";
  const TITLE = purpose === "receipt" ? "Upload the signed receipt" : "Attach a file";
  const [phase, setPhase] = useState<"ask" | "uploading" | "done">("ask");
  const [error, setError] = useState("");
  const [doneText, setDoneText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ pick: () => inputRef.current?.click() }), []);

  // After a success: a moment to read it, then slide away.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => onOpenChange(false), 1500);
    return () => clearTimeout(t);
  }, [phase, onOpenChange]);

  // Once it has slid away, ready for the next time.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => { setPhase("ask"); setError(""); setDoneText(""); }, 350);
    return () => clearTimeout(t);
  }, [open]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    setError("");
    setPhase("uploading");
    onOpenChange(true);
    const attached: string[] = [];
    const refused: string[] = [];
    for (const f of files) {
      const r = purpose === "receipt"
        ? await uploadAttachment(orderId, f, "proof_of_delivery")
        : await uploadAttachment(orderId, f, "general", null, "acknowledgments");
      if (r.ok) attached.push(f.name); else refused.push(r.message);
    }
    if (attached.length === 0) { setError(refused.join(" · ")); setPhase("ask"); return; }
    setDoneText(`${attached.length === 1 ? attached[0] : `${attached.length} files`} attached to “${GROUP}”.`
      + (refused.length ? ` Not attached: ${refused.join(" · ")}` : ""));
    setPhase("done");
  }

  return (
    <>
    <div aria-hidden={!open} inert={!open}
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
      <div className="overflow-hidden min-h-0">
        <div className="pt-2.5">
          <div role="region" aria-label={TITLE} className="glass-sage rounded-panel px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(184,130,106,0.14)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
                {phase === "done" ? <Check className="w-4 h-4" style={{ color: "#a9cf8f" }} /> : <Paperclip className="w-4 h-4" style={{ color: "#d9a888" }} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-cream/90">{TITLE}</p>
                {phase === "done" ? (
                  <p role="status" className="text-[12px] text-cream/70 mt-0.5">{doneText}</p>
                ) : phase === "uploading" ? (
                  <p role="status" className="text-[12px] text-cream/70 mt-0.5 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Uploading to “{GROUP}”…
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] text-cream/65 mt-0.5">It goes in this order’s “{GROUP}” group.</p>
                    {error && <p role="alert" className="text-[11px] mt-1.5" style={{ color: "#e08585" }}>{error}</p>}
                    <div className="mt-2.5">
                      <button onClick={() => inputRef.current?.click()} className={BUTTON}>
                        <Paperclip className="w-3 h-3" /> Choose a file
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => onOpenChange(false)} title="Close" aria-label="Close" className="p-1 text-cream/50 hover:text-cream"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
    {/* ⚠ BESIDE THE INERT WRAPPER, NOT IN IT: pick() opens this while the card is
        still closed (inert), and a click into an inert subtree may be ignored. */}
    <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e)}
      accept={purpose === "receipt" ? "image/*,.pdf" : "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"} />
    </>
  );
});
