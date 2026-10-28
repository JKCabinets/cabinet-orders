"use client";

/**
 * The Overview's Files card (2026-10-28, item 8 step 5d; Garrett: "one Files tab
 * with everything, tiles on the Overview, the old card and pane gone").
 *
 * One tile per FILE GROUP of the selected order group -- its name and how many
 * files it holds -- and a tile opens the Files tab AT that group (scrolled to,
 * briefly highlighted). "Open Files" opens the tab at the top. Everything done
 * to files is done there; this card only shows where they are.
 *
 * Reads the same cached list as the Files tab (useAttachments): no request of
 * its own, and it stays current with uploads, moves and realtime alike.
 */
import { Paperclip, Folder, ChevronRight } from "lucide-react";
import { useAttachments, followsRoom } from "@/lib/attachments";

const LABEL = "text-[10px] uppercase tracking-[0.16em] text-cream/60";

export function FileGroupTiles({ orderId, onOpen }: { orderId: string; onOpen: (groupId: number | null) => void }) {
  const list = useAttachments(orderId);
  const groups = list.groups ?? [];
  const files = list.files ?? [];
  const countIn = (id: number) => files.filter((f) => f.group_id === id).length;
  return (
    <div className="glass-sage rounded-panel px-4 py-3.5">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(184,130,106,0.14)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
          <Paperclip className="w-3.5 h-3.5" style={{ color: "#d9a888" }} />
        </span>
        <p className={LABEL}>Files {list.files !== null && <span className="text-cream/45 normal-case tracking-normal ml-1">{files.length}</span>}</p>
        <button onClick={() => onOpen(null)}
          className="ml-auto text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
          Open Files
        </button>
      </div>
      {list.files === null ? (
        <p className="text-[11px] text-cream/40">{list.error ? `The files could not be loaded: ${list.error}` : "Loading files…"}</p>
      ) : groups.length === 0 ? (
        <p className="text-[11px] text-cream/45">No file groups yet. Open Files to make one and attach to it.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {groups.map((g) => {
            const n = countIn(g.id);
            return (
              <button key={g.id} onClick={() => onOpen(g.id)} title={`Open ${g.name} in Files`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all hover:brightness-125 min-w-0"
                style={{ background: "rgba(255,255,255,0.035)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
                <Folder className="w-3.5 h-3.5 flex-shrink-0 text-cream/50" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] text-cream/85 truncate">{g.name}</span>
                  <span className="block text-[10px] text-cream/45">
                    {n} file{n === 1 ? "" : "s"}{followsRoom(g) ? " · follows its room" : ""}
                  </span>
                </span>
                <ChevronRight className="w-3 h-3 flex-shrink-0 text-cream/35" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
