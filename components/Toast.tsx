"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

/**
 * Global toast system. Wrap the app once at the layout level:
 *
 *   <ToastProvider>
 *     <App />
 *   </ToastProvider>
 *
 * Then anywhere inside, call:
 *
 *   const { showToast } = useToast();
 *   showToast("Saved", { kind: "success" });
 *   showToast("Already claimed by Aaron", { kind: "warn" });
 *   showToast("Network error", { kind: "error" });
 *
 * Toasts stack in the bottom-right and auto-dismiss after 3 seconds
 * (4 for errors). Each toast has its own timer so they fade
 * independently. The X button dismisses early.
 *
 * Why not a third-party library? The whole component is ~100 lines
 * of state we already understand. No build size, no surprises.
 */

type ToastKind = "success" | "warn" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastCtx {
  showToast: (message: string, opts?: { kind?: ToastKind; durationMs?: number }) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Soft fallback so calling useToast in tests / SSR doesn\'t crash.
    // In real usage this should always have a provider above it.
    return {
      showToast: (msg) => {
        if (typeof console !== "undefined") {
          console.log("[toast]", msg);
        }
      },
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback<ToastCtx["showToast"]>((message, opts) => {
    const kind = opts?.kind ?? "info";
    const duration = opts?.durationMs ?? (kind === "error" ? 4000 : 3000);
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Subtle entrance animation — mounted into DOM with opacity 0
  // then bumped to 1 next frame.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const palette = PALETTES[toast.kind];
  const Icon = palette.icon;

  return (
    <div
      className={[
        "pointer-events-auto",
        "flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-xs shadow-2xl shadow-black/50",
        "transition-all duration-200",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        palette.bg,
        palette.border,
        palette.text,
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${palette.iconColor}`} />
      <span className="flex-1 leading-snug whitespace-pre-wrap">{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
      >
        <X className="w-3 h-3 opacity-60" />
      </button>
    </div>
  );
}

const PALETTES: Record<ToastKind, {
  icon: typeof CheckCircle2;
  iconColor: string;
  bg: string;
  border: string;
  text: string;
}> = {
  success: {
    icon: CheckCircle2,
    iconColor: "text-emerald-400",
    bg: "bg-[rgba(20,30,20,0.95)] backdrop-blur",
    border: "border border-emerald-800/50",
    text: "text-[#e8e3da]",
  },
  warn: {
    icon: AlertTriangle,
    iconColor: "text-amber-300",
    bg: "bg-[rgba(35,28,15,0.95)] backdrop-blur",
    border: "border border-amber-700/50",
    text: "text-[#e8e3da]",
  },
  error: {
    icon: AlertTriangle,
    iconColor: "text-red-400",
    bg: "bg-[rgba(35,15,15,0.95)] backdrop-blur",
    border: "border border-red-800/50",
    text: "text-[#e8e3da]",
  },
  info: {
    icon: Info,
    iconColor: "text-[rgba(232,227,218,0.55)]",
    bg: "bg-[rgba(20,20,20,0.95)] backdrop-blur",
    border: "border border-[rgba(255,255,255,0.10)]",
    text: "text-[#e8e3da]",
  },
};
