"use client";

import { useState, useEffect } from "react";
import { Shield, ChevronDown, ChevronUp, RefreshCw, Unlock } from "lucide-react";
import clsx from "clsx";

interface AuditEntry {
  id: number;
  event: string;
  username: string;
  ip_address: string;
  details: Record<string, unknown>;
  created_at: string;
}

const EVENT_STYLES: Record<string, { color: string; label: string }> = {
  login_success:    { color: "text-green-400",  label: "Login" },
  login_failed:     { color: "text-red-400",    label: "Failed login" },
  login_blocked:    { color: "text-red-500",    label: "Blocked" },
  logout:           { color: "text-[#9e9888]",  label: "Logout" },
  password_changed: { color: "text-amber-400",  label: "Password changed" },
  account_unlocked: { color: "text-blue-400",   label: "Unlocked" },
};

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  async function fetchLog() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/audit?limit=50");
      const data = await res.json();
      if (data.data) setEntries(data.data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { fetchLog(); }, []);

  async function unlockAccount(username: string) {
    setUnlocking(username);
    try {
      await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      await fetchLog();
    } catch { /* ignore */ }
    setUnlocking(null);
  }

  const lockedUsers = entries
    .filter(e => e.event === "login_blocked")
    .map(e => e.username)
    .filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="border border-[#2e2e2e] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[#181818] hover:bg-[#1e1e1e] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Shield className="w-3.5 h-3.5 text-[#9e9888]" />
          <span className="text-sm font-medium text-[#9e9888]">Security audit log</span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-[#111] border border-[#2e2e2e] text-[#5a5650]">
            {entries.length} events
          </span>
          {lockedUsers.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-red-950/40 border border-red-900/50 text-red-400">
              {lockedUsers.length} locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); fetchLog(); }}
            className="p-1 text-[#5a5650] hover:text-[#9e9888] transition-colors"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#5a5650]" /> : <ChevronDown className="w-4 h-4 text-[#5a5650]" />}
        </div>
      </button>

      {expanded && (
        <div className="bg-[#0f0f0f]">
          {/* Locked accounts */}
          {lockedUsers.length > 0 && (
            <div className="px-5 py-3 border-b border-[#2e2e2e]">
              <p className="text-[10px] uppercase tracking-widest text-red-400 mb-2">Locked accounts</p>
              <div className="flex flex-col gap-1.5">
                {lockedUsers.map(username => (
                  <div key={username} className="flex items-center justify-between px-3 py-2 bg-red-950/20 border border-red-900/30 rounded-lg">
                    <span className="text-xs text-red-300 font-mono">@{username}</span>
                    <button
                      onClick={() => unlockAccount(username)}
                      disabled={unlocking === username}
                      className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Unlock className="w-3 h-3" />
                      {unlocking === username ? "Unlocking..." : "Unlock"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log entries */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#2e2e2e]">
                  <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-widest text-[#3e3e3e] font-medium">Event</th>
                  <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#3e3e3e] font-medium">User</th>
                  <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#3e3e3e] font-medium">IP</th>
                  <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#3e3e3e] font-medium">Details</th>
                  <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#3e3e3e] font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[#5a5650]">Loading...</td></tr>
                )}
                {!loading && entries.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[#5a5650]">No events yet</td></tr>
                )}
                {entries.map(entry => {
                  const style = EVENT_STYLES[entry.event] ?? { color: "text-[#9e9888]", label: entry.event };
                  const details = entry.details;
                  const detailStr = details?.reason
                    ? String(details.reason).replace(/_/g, " ")
                    : details?.attempts
                    ? `attempt ${details.attempts}`
                    : details?.changed_by
                    ? `by ${details.changed_by}`
                    : "";

                  return (
                    <tr key={entry.id} className="border-b border-[#2e2e2e]/50 hover:bg-[#181818]/50 transition-colors">
                      <td className={clsx("px-5 py-2.5 font-medium", style.color)}>{style.label}</td>
                      <td className="px-3 py-2.5 font-mono text-[#9e9888]">@{entry.username}</td>
                      <td className="px-3 py-2.5 text-[#5a5650] font-mono">{entry.ip_address}</td>
                      <td className="px-3 py-2.5 text-[#5a5650]">{detailStr}</td>
                      <td className="px-3 py-2.5 text-[#5a5650] whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" "}
                        {new Date(entry.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
