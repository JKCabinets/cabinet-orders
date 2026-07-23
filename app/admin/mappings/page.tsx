"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { Table2, RefreshCw, Loader2, AlertTriangle, Search } from "lucide-react";
import clsx from "clsx";

/**
 * /admin/mappings — the SKU mapping table (Step 5).
 *
 * This is the page that makes the decoder's promise real: when Avis introduces
 * a colour, door style or modification, an admin assigns its code HERE instead
 * of waiting on a deploy. Saving warms the server cache, so the next order
 * decodes with it and already-flagged orders can be cleared with Re-decode.
 *
 * Only `sku_code` is editable. vendor/kind/avis_name are the identity the Avis
 * sync matches on — editing them would orphan the row on the next sync.
 */

interface MappingRow {
  id: string;
  vendor: string;
  kind: string;
  avis_name: string;
  sku_code: string | null;
  source: string;
  role: string;
  active: boolean;
}

const KIND_LABEL: Record<string, string> = {
  door_style: "Door styles",
  color: "Colors",
  modification: "Modifications",
};

const KIND_ORDER = ["door_style", "color", "modification"];

export default function MappingsPage() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const user = session?.user as { role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyNeedsCode, setOnlyNeedsCode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Enter blurs the input, so the commit would otherwise run twice.
  const committingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/mappings");
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Could not load the mappings");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setLoadError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function commitCode(row: MappingRow, value: string) {
    if (committingRef.current) return;
    const next = value.trim().toUpperCase();
    if ((next || null) === (row.sku_code ?? null)) {
      setEditingId(null);
      return;
    }
    committingRef.current = true;
    setSavingId(row.id);
    try {
      const res = await fetch("/api/admin/mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, sku_code: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Could not save the code", { kind: "error" });
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === row.id ? (data.row as MappingRow) : r)));
      showToast(
        data.row.sku_code
          ? `${data.row.avis_name} → ${data.row.sku_code}`
          : `Cleared the code for ${data.row.avis_name}`,
        { kind: "success" },
      );
      if (data.cache_refreshed === false) {
        showToast("Saved, but the cache did not reload — use Refresh cache.", { kind: "warn" });
      }
    } catch {
      showToast("Network error — the code was not saved", { kind: "error" });
    } finally {
      committingRef.current = false;
      setSavingId(null);
      setEditingId(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/mappings/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Could not reload the cache", { kind: "error" });
        return;
      }
      const c = data.counts ?? {};
      showToast(
        `Cache reloaded — ${c.door_styles ?? 0} door styles, ${c.colors ?? 0} colors, ${c.modifications ?? 0} modifications`,
        { kind: "success" },
      );
    } catch {
      showToast("Network error — the cache was not reloaded", { kind: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  if (session && !isAdmin) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-cream/55 text-sm">Access denied. Admins only.</p>
        </div>
      </AppShell>
    );
  }

  const needsCode = rows.filter((r) => !r.sku_code);
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (onlyNeedsCode && r.sku_code) return false;
    if (!q) return true;
    return (
      r.avis_name.toLowerCase().includes(q) ||
      (r.sku_code ?? "").toLowerCase().includes(q) ||
      r.vendor.toLowerCase().includes(q)
    );
  });

  // vendor -> kind -> rows, with uncoded values floated to the top of each group
  // because assigning them is the whole point of the page.
  const byVendor = new Map<string, Map<string, MappingRow[]>>();
  for (const r of visible) {
    const kinds = byVendor.get(r.vendor) ?? new Map<string, MappingRow[]>();
    kinds.set(r.kind, [...(kinds.get(r.kind) ?? []), r]);
    byVendor.set(r.vendor, kinds);
  }
  const vendors = Array.from(byVendor.keys()).sort();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Settings"
        title="SKU mappings"
        accent="admin"
        right={
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-cream/50" />
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-900/30 text-amber-300 border border-amber-700/40 uppercase tracking-wider">
              Admin
            </span>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Mappings", value: rows.length },
            { label: "Needs a code", value: needsCode.length },
            { label: "Inactive", value: rows.filter((r) => !r.active).length },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl px-4 py-3.5"
            >
              <p className="text-xs text-[rgba(232,227,218,0.50)] mb-1">{s.label}</p>
              <p
                className={clsx(
                  "text-2xl font-medium",
                  s.label === "Needs a code" && s.value > 0 ? "text-[#e8b866]" : "text-[#e8e3da]",
                )}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cream/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a value or code…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-xs text-[#e8e3da] placeholder:text-cream/30 focus:outline-none focus:border-[rgba(86,100,72,0.55)]"
            />
          </div>
          <button
            onClick={() => setOnlyNeedsCode((v) => !v)}
            className={clsx(
              "px-3 py-2 rounded-lg border text-xs transition-all whitespace-nowrap",
              onlyNeedsCode
                ? "bg-[rgba(224,168,72,0.14)] border-[rgba(224,168,72,0.45)] text-[#e8b866]"
                : "border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)]",
            )}
          >
            Needs a code
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Reload the server's mapping cache"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.10)] text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {refreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh cache
          </button>
        </div>

        {loading ? (
          <div className="min-h-[30vh] flex items-center justify-center">
            <p className="text-sm text-cream/35">Loading mappings…</p>
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-[rgba(201,112,112,0.4)] bg-[rgba(201,112,112,0.10)]">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#e89090" }} />
            <div>
              <p className="text-xs text-cream/85">{loadError}</p>
              <button
                onClick={() => void load()}
                className="mt-1 text-[11px] text-cream/60 hover:text-cream/90 underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-cream/35 py-10 text-center">
            {onlyNeedsCode ? "Every mapping has a code." : "No mappings match that search."}
          </p>
        ) : (
          vendors.map((vendor) => {
            const kinds = byVendor.get(vendor)!;
            const kindKeys = Array.from(kinds.keys()).sort(
              (a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99),
            );
            return (
              <div key={vendor} className="mb-8">
                <h2 className="text-sm font-medium text-[rgba(232,227,218,0.50)] mb-3">{vendor}</h2>
                {kindKeys.map((kind) => {
                  const list = [...(kinds.get(kind) ?? [])].sort((a, b) => {
                    if (!a.sku_code !== !b.sku_code) return a.sku_code ? 1 : -1;
                    return a.avis_name.localeCompare(b.avis_name);
                  });
                  return (
                    <div key={kind} className="mb-4">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-cream/35 mb-2">
                        {KIND_LABEL[kind] ?? kind}
                        <span className="ml-2 text-cream/25">{list.length}</span>
                      </p>
                      <div className="border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
                        {list.map((row, i) => (
                          <MappingRowView
                            key={row.id}
                            row={row}
                            first={i === 0}
                            editing={editingId === row.id}
                            saving={savingId === row.id}
                            onStartEdit={() => setEditingId(row.id)}
                            onCancel={() => setEditingId(null)}
                            onCommit={(v) => void commitCode(row, v)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}

        <p className="text-xs text-[rgba(232,227,218,0.30)] leading-relaxed">
          Codes are stored in the <span className="font-mono">sku_mappings</span> table and take
          effect as soon as they are saved — no deploy needed. Values come from Avis, so the name,
          vendor and kind are read-only here. An order already flagged for an unmapped value clears
          once you assign the code and press Re-decode on it.
        </p>
      </div>
    </AppShell>
  );
}

function MappingRowView({
  row,
  first,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onCommit,
}: {
  row: MappingRow;
  first: boolean;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onCommit: (value: string) => void;
}) {
  const missing = !row.sku_code;
  return (
    <div
      className={clsx(
        "flex items-center gap-3 px-4 py-2.5",
        !first && "border-t border-[rgba(255,255,255,0.07)]",
        missing && "bg-[rgba(224,168,72,0.06)]",
        !row.active && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#e8e3da] truncate">{row.avis_name}</p>
        <p className="text-[10px] text-[rgba(232,227,218,0.30)]">
          {row.role} · {row.source}
          {!row.active && " · inactive"}
        </p>
      </div>

      {missing && !editing && (
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#e8b866] whitespace-nowrap">
          <AlertTriangle className="w-3 h-3" /> needs a code
        </span>
      )}

      {editing ? (
        <input
          autoFocus
          defaultValue={row.sku_code ?? ""}
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = row.sku_code ?? "";
              onCancel();
            }
          }}
          onBlur={(e) => onCommit(e.currentTarget.value)}
          placeholder="e.g. 410F"
          className="w-28 px-2 py-1 rounded-md bg-[rgba(255,255,255,0.06)] border border-[rgba(86,100,72,0.55)] text-xs font-mono text-[#e8e3da] uppercase focus:outline-none disabled:opacity-50"
        />
      ) : (
        <button
          onClick={onStartEdit}
          title="Click to edit this code"
          className={clsx(
            "w-28 px-2 py-1 rounded-md border text-xs font-mono text-left transition-all",
            missing
              ? "border-[rgba(224,168,72,0.45)] text-[rgba(232,227,218,0.35)] hover:border-[rgba(224,168,72,0.75)]"
              : "border-[rgba(255,255,255,0.10)] text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)]",
          )}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : row.sku_code ?? "assign…"}
        </button>
      )}
    </div>
  );
}
