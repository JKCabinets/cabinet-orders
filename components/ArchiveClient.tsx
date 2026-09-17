"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { Order, Project, OrderType } from "@/lib/data";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { StagePill } from "@/components/OrderTable";
import { Search, RotateCcw, Loader2, Archive as ArchiveIcon } from "lucide-react";
import clsx from "clsx";

/**
 * /archive — the history of everything that has been put away.
 *
 * ⚠ ONE LINE PER PURCHASE, NOT PER GROUP. A customer bought one thing; the
 * cabinet, hardware and sample groups exist so the backend can track parts that
 * move at different speeds. The archive is the customer's view of a finished
 * job, so a purchase is one line and its parts are shown ON it, with the stage
 * each one stopped at. Restoring that line restores the whole purchase, which
 * is the same rule as archiving it.
 *
 * Standalone rows -- custom jobs and warranty claims -- are archived on their
 * own and get one line each.
 *
 * ⚠ IT READS allOrdersIncludingArchived, NOT allOrders. The store hides the
 * groups of an archived purchase from `allOrders`, which is right everywhere
 * else and fatal here: the projects hub's old Archived filter listed archived
 * purchases with zero parts for exactly that reason.
 *
 * ⚠ NOTHING HERE EDITS. Every write route refuses an archived row (409
 * `archived_read_only`, see lib/archived.ts); restore is the one way out, and
 * it is the only action this screen offers. The modal it opens is still the
 * ordinary one -- stripping its controls is the next step -- so its buttons
 * will fail loudly rather than silently.
 */

type Tab = "all" | "shopify" | "custom" | "warranty";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "shopify", label: "Shopify Orders" },
  { key: "custom", label: "Custom Orders" },
  { key: "warranty", label: "Warranty Orders" },
];

const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
};

/** A purchase, or a standalone row: the two kinds of thing that get archived. */
type Entry =
  | { kind: "purchase"; id: string; name: string; archivedAt: string | null; project: Project; groups: Order[] }
  | { kind: "row"; id: string; name: string; archivedAt: string | null; order: Order };

/**
 * When it was archived, or "—".
 *
 * ⚠ NULL IS EXPECTED, NOT A BUG. `archived_at` arrived on 2026-09-16; anything
 * archived before that has no date and sorts last rather than pretending to a
 * position it cannot have.
 */
function archivedLabel(at: string | null): string {
  if (!at) return "\u2014";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix",
  });
}

export function ArchiveClient() {
  const { allOrdersIncludingArchived, projects, archiveProject, unarchiveOrder } = useStore();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Why the server refused, keyed by entry id. Shown on the line itself. */
  const [refusal, setRefusal] = useState<Record<string, string>>({});

  const entries = useMemo<Entry[]>(() => {
    const groups = new Map<string, Order[]>();
    for (const o of allOrdersIncludingArchived) {
      if (!o.project_id) continue;
      const list = groups.get(o.project_id) ?? [];
      list.push(o);
      groups.set(o.project_id, list);
    }
    // Cabinets, hardware, samples -- the order the modal and the projects hub
    // use, so a purchase reads the same everywhere.
    const rank: Record<string, number> = { order: 0, hardware: 1, sample: 2 };
    for (const list of groups.values()) list.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

    const out: Entry[] = [];
    for (const p of Object.values(projects) as Project[]) {
      if (!p.archived) continue;
      out.push({
        kind: "purchase", id: p.id, name: String(p.name ?? ""),
        archivedAt: p.archived_at ?? null, project: p, groups: groups.get(p.id) ?? [],
      });
    }
    for (const o of allOrdersIncludingArchived) {
      if (!o.archived || o.project_id) continue;
      out.push({ kind: "row", id: o.id, name: o.name ?? "", archivedAt: o.archived_at ?? null, order: o });
    }

    // Newest first; anything with no date last, in id order so the list is
    // stable rather than arbitrary.
    return out.sort((a, b) => {
      if (a.archivedAt && b.archivedAt) return b.archivedAt.localeCompare(a.archivedAt);
      if (a.archivedAt) return -1;
      if (b.archivedAt) return 1;
      return a.id.localeCompare(b.id);
    });
  }, [allOrdersIncludingArchived, projects]);

  const inTab = (e: Entry, t: Tab) =>
    t === "all" ? true
    : t === "shopify" ? e.kind === "purchase"
    : e.kind === "row" && e.order.type === (t as OrderType);

  const counts = useMemo(() => ({
    all: entries.length,
    shopify: entries.filter((e) => inTab(e, "shopify")).length,
    custom: entries.filter((e) => inTab(e, "custom")).length,
    warranty: entries.filter((e) => inTab(e, "warranty")).length,
  }), [entries]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!inTab(e, tab)) return false;
      if (!q) return true;
      if (e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) return true;
      if (e.kind === "purchase") {
        return String(e.project.customer_email ?? "").toLowerCase().includes(q)
          || String(e.project.ship_to ?? "").toLowerCase().includes(q)
          || e.groups.some((g) => g.id.toLowerCase().includes(q));
      }
      return String(e.order.detail ?? "").toLowerCase().includes(q);
    });
  }, [entries, tab, search]);

  /**
   * Restore, and say why if the server refuses.
   *
   * A purchase goes back through the projects route -- the same call the
   * projects hub makes to archive it -- and a standalone row through the order
   * route. Neither invents a stage: archiving never moved one, so everything
   * comes back exactly where it stopped.
   */
  async function doRestore(e: Entry) {
    setBusyId(e.id);
    setRefusal((prev) => { const n = { ...prev }; delete n[e.id]; return n; });
    const res = e.kind === "purchase"
      ? await archiveProject(e.id, false)
      : await unarchiveOrder(e.id);
    setBusyId(null);
    if (!res.ok) {
      setRefusal((prev) => ({ ...prev, [e.id]: res.message ?? "Could not restore this. Try again." }));
    }
  }

  return (
    <>
      <PageHeader eyebrow="Stored history" title="The" accent="archive" />

      <main className="px-6 lg:px-8 pb-16">
        {/* Tabs. Counts are of the archive itself, so an empty tab says so
            rather than looking broken. */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                "px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all border",
                tab === t.key
                  ? "bg-white/10 border-cream/25 text-cream"
                  : "bg-white/4 border-white/10 text-cream/55 hover:text-cream/80",
              )}
            >
              {t.label}
              <span className="ml-1.5 text-cream/45">{counts[t.key]}</span>
            </button>
          ))}

          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cream/35" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the archive…"
              className="pl-8 pr-3 py-1.5 w-56 rounded-full text-[12px] bg-white/5 border border-white/10 text-cream placeholder:text-cream/35 focus:outline-none focus:border-cream/25"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-[12px] text-cream/45 py-8">
            {search.trim()
              ? "Nothing in the archive matches that."
              : "Nothing archived here yet."}
          </p>
        ) : (
          <div className="rounded-xl border border-white/8 overflow-hidden">
            {rows.map((e) => (
              <div key={`${e.kind}:${e.id}`} className="border-b border-white/6 last:border-b-0">
                <div className="px-4 py-3 flex items-center gap-3 hover:bg-white/3 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] text-cream/90">{e.id}</span>
                      {e.name && <span className="text-[12px] text-cream/50 truncate">{e.name}</span>}
                      <span className="text-[10px] uppercase tracking-wider text-cream/35 px-1.5 py-px rounded-full border border-white/10">
                        {e.kind === "purchase" ? "Shopify" : e.order.type === "custom" ? "Custom" : "Warranty"}
                      </span>
                    </div>

                    {/* The parts, and where each stopped. Information, not
                        actions: they were archived together and come back
                        together. Clicking one opens it. */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {e.kind === "purchase" ? (
                        e.groups.length === 0 ? (
                          <span className="text-[11px] text-cream/35">No orders on this purchase</span>
                        ) : e.groups.map((g) => (
                          <button
                            key={g.id}
                            onClick={() => setSelected(g)}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/4 border border-white/8 hover:border-cream/20 transition-colors"
                            title={`Open ${g.id}`}
                          >
                            <span className="text-[10px] uppercase tracking-wider text-cream/55">
                              {GROUP_LABEL[g.type] ?? g.type}
                            </span>
                            <StagePill stage={g.stage} type={g.type} />
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() => setSelected(e.order)}
                          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/4 border border-white/8 hover:border-cream/20 transition-colors"
                          title={`Open ${e.order.id}`}
                        >
                          <StagePill stage={e.order.stage} type={e.order.type} />
                        </button>
                      )}
                    </div>

                    {refusal[e.id] && (
                      <p className="text-[11px] mt-1.5" style={{ color: "#e8b56a" }}>{refusal[e.id]}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-cream/40 whitespace-nowrap" title="When this was archived">
                      {archivedLabel(e.archivedAt)}
                    </span>
                    <button
                      onClick={() => void doRestore(e)}
                      disabled={busyId === e.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10 disabled:opacity-50"
                      title={e.kind === "purchase"
                        ? "Restore this purchase and every order in it"
                        : "Restore this to the board"}
                    >
                      {busyId === e.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RotateCcw className="w-3 h-3" />}
                      Restore
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-cream/35 mt-4">
          <ArchiveIcon className="w-3 h-3" />
          Archived work is read-only. Restore it to change anything.
        </p>
      </main>

      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onStageChange={(s) => setSelected((prev) => (prev ? { ...prev, stage: s } : null))}
        />
      )}
    </>
  );
}
