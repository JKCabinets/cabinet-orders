"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import clsx from "clsx";
import { Package, LogOut, Settings, Calendar, RefreshCw, Menu, X } from "lucide-react";

interface TopBarProps {
  tab: "orders" | "warranty";
  onTabChange: (tab: "orders" | "warranty") => void;
}

const G: React.CSSProperties = {
  background: "rgba(255,255,255,0.20)",
  backdropFilter: "blur(28px) saturate(160%)",
  WebkitBackdropFilter: "blur(28px) saturate(160%)",
  border: "0.5px solid rgba(255,255,255,0.15)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 16px rgba(0,0,0,0.30)",
};

export function TopBar({ tab, onTabChange }: TopBarProps) {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  const navBtn: React.CSSProperties = {
    ...G,
    display: "flex", alignItems: "center", gap: "5px",
    padding: "6px 11px", borderRadius: "9px", fontSize: "11px",
    color: "rgba(232,227,218,0.55)", cursor: "pointer",
  };

  return (
    <header className="sticky top-0 z-40 px-3 md:px-5 py-3" style={{ background: "transparent" }}>
      {/* Floating topbar pill */}
      <div
        className="flex items-center justify-between px-4 py-2.5 rounded-2xl"
        style={{
          background: "rgba(255,255,255,0.15)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "0.5px solid rgba(255,255,255,0.18)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.35)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{
            background: "rgba(86,100,72,0.25)",
            border: "0.5px solid rgba(86,100,72,0.75)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), 0 2px 8px rgba(86,100,72,0.20)",
          }}>
            <Package className="w-3.5 h-3.5" style={{ color: "#a0cc7a" }} />
          </div>
          <span className="text-xs font-semibold tracking-wide text-[#e8e3da] hidden sm:block">JK Cabinets</span>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl" style={{
          background: "rgba(0,0,0,0.15)",
          border: "0.5px solid rgba(255,255,255,0.18)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.15)",
        }}>
          {(["orders", "warranty"] as const).map((t) => (
            <button key={t} onClick={() => onTabChange(t)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={tab === t ? {
                background: "rgba(86,100,72,0.28)",
                border: "0.5px solid rgba(86,100,72,0.75)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 8px rgba(86,100,72,0.20)",
                color: "#f0ece4",
              } : { color: "rgba(232,227,218,0.60)", border: "0.5px solid transparent" }}
            >
              {t === "orders" ? "All orders" : "Warranty"}
            </button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center gap-1.5">
          <div className="hidden md:flex items-center gap-1.5">
            <Link href="/calendar" style={navBtn}><Calendar className="w-3.5 h-3.5" /><span>Calendar</span></Link>
            {isAdmin && <>
              <Link href="/admin/shopify" style={navBtn}><RefreshCw className="w-3.5 h-3.5" /><span>Shopify</span></Link>
              <Link href="/admin" style={navBtn}><Settings className="w-3.5 h-3.5" /><span>Admin</span></Link>
            </>}
            <button onClick={() => signOut({ callbackUrl: "/login" })}
              style={{ ...navBtn, color: "rgba(232,227,218,0.45)" }}
              className="hover:!text-red-400 hover:!border-red-800">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={() => setMenuOpen(v => !v)} className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg" style={navBtn}>
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden mt-2 rounded-2xl overflow-hidden" style={{
          background: "rgba(255,255,255,0.20)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border: "0.5px solid rgba(255,255,255,0.15)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.40)",
        }}>
          {[
            { href: "/calendar", icon: <Calendar className="w-4 h-4" />, label: "Delivery calendar" },
            ...(isAdmin ? [
              { href: "/admin/shopify", icon: <RefreshCw className="w-4 h-4" />, label: "Shopify sync" },
              { href: "/admin", icon: <Settings className="w-4 h-4" />, label: "Team admin" },
            ] : []),
          ].map(item => (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm text-[rgba(232,227,218,0.55)] hover:text-[#e8e3da] hover:bg-[rgba(255,255,255,0.07)] transition-all"
              style={{ borderBottom: "0.5px solid rgba(255,255,255,0.20)" }}>
              {item.icon} {item.label}
            </Link>
          ))}
          <button onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[rgba(232,227,218,0.55)] hover:text-red-400 hover:bg-[rgba(255,255,255,0.18)] transition-all">
            <LogOut className="w-4 h-4" /> Sign out
            {user?.name && <span className="ml-auto text-xs text-[rgba(232,227,218,0.45)]">{user.name}</span>}
          </button>
        </div>
      )}
    </header>
  );
}
