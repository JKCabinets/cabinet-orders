"use client";

import React, {
  createContext, useContext, useState,
  useCallback, useEffect, ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import {
  Order, Stage, TeamMember,
  Member, Source, ORDER_STAGES, WARRANTY_STAGES, AvatarColor, Role,
} from "./data";
import { fieldsToClearOnBackwardMove } from "./stageLogic";
import { useRealtimeOrders } from "./useRealtimeOrders";
import { usePresence } from "./usePresence";

interface StoreCtx {
  orders: Order[];
  warranties: Order[];
  team: TeamMember[];
  onlineUsers: string[];
  loading: boolean;
  addOrder: (o: Partial<Order> & { type: "order" | "warranty" }) => Promise<void>;
  moveStage: (id: string, stage: Stage, enteredByName?: string, adminPin?: string) => Promise<{ ok: boolean; pinRequired?: boolean; error?: string }>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  updateInternalNotes: (id: string, internal_notes: string) => Promise<void>;
  archiveOrder: (id: string) => Promise<void>;
  unarchiveOrder: (id: string) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  bulkAction: (
    ids: string[],
    action: { type: "move"; stage: Stage; adminPin?: string } | { type: "archive"; archived: boolean }
  ) => Promise<{ succeeded: number; failed: number; results: { id: string; ok: boolean; error?: string }[]; pinRequired?: boolean } | null>;
  updateOrderDetails: (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[]; production_start_date?: string | null; production_est_finish_date?: string | null; scheduled_delivery_date?: string | null }) => Promise<void>;
  claimOrder: (id: string, claimedBy: string | null) => Promise<boolean>;
  addTeamMember: (m: Omit<TeamMember, "id">) => Promise<void>;
  updateTeamMember: (id: string, updates: Partial<TeamMember> & { password?: string }) => Promise<void>;
  deactivateTeamMember: (id: string) => Promise<void>;
  deleteTeamMember: (id: string) => Promise<void>;
}

const Store = createContext<StoreCtx | null>(null);

async function apiCall(url: string, method = "GET", body?: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function shapeOrder(raw: Record<string, unknown>): Order {
  return {
    id: raw.id as string,
    type: (raw.type as "order" | "warranty") ?? "order",
    name: raw.name as string,
    source: (raw.source as Source) ?? "Manual",
    detail: (raw.detail as string) ?? "",
    stage: (raw.stage as Stage) ?? "New",
    member: (raw.member as Member) ?? "AX",
    date: (raw.date as string) ?? "",
    sku: (raw.sku as string) ?? "",
    notes: (raw.notes as string) ?? "",
    internal_notes: (raw.internal_notes as string) ?? "",
    archived: (raw.archived as boolean) ?? false,
    activity: (raw.activity as { text: string; time: string }[]) ?? [],
    door_style: (raw.door_style as string) ?? "",
    color: (raw.color as string) ?? "",
    sku_items: (raw.sku_items as { sku: string; quantity: number; description?: string }[]) ?? [],
    claimed_by: (raw.claimed_by as string | null) ?? null,
    entered_by: (raw.entered_by as string | null) ?? null,
    vendor: (raw.vendor as string) ?? "",
    ship_to: (raw.ship_to as string) ?? "",
    customer_phone: (raw.customer_phone as string) ?? "",
    customer_email: (raw.customer_email as string) ?? "",
    delivery_method: (raw.delivery_method as string) ?? "",
    payment_status: (raw.payment_status as string | null) ?? null,
    stage_entered_at: (raw.stage_entered_at as string | null) ?? null,
    production_start_date: (raw.production_start_date as string | null) ?? null,
    production_est_finish_date: (raw.production_est_finish_date as string | null) ?? null,
    scheduled_delivery_date: (raw.scheduled_delivery_date as string | null) ?? null,
  };
}

function shapeTeamMember(raw: Record<string, unknown>): TeamMember {
  return {
    id: raw.id as string,
    username: raw.username as string,
    name: raw.name as string,
    initials: raw.initials as string,
    role: (raw.role as Role) ?? "member",
    avatarColor: ((raw.avatar_color ?? raw.avatarColor) as AvatarColor) ?? "blue",
    active: (raw.active as boolean) ?? true,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [warranties, setWarranties] = useState<Order[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Only load data once session is authenticated
  useEffect(() => {
    if (status !== "authenticated") return;

    async function load() {
      setLoading(true);
      const [ordersRes, warrantiesRes, teamRes] = await Promise.all([
        apiCall("/api/orders?type=order"),
        apiCall("/api/orders?type=warranty"),
        apiCall("/api/team"),
      ]);
      if (ordersRes?.data)     setOrders(ordersRes.data.map(shapeOrder));
      if (warrantiesRes?.data) setWarranties(warrantiesRes.data.map(shapeOrder));
      if (teamRes?.data)       setTeam(teamRes.data.map(shapeTeamMember));
      setLoading(false);
    }
    load();
  }, [status]);

  // Realtime: subscribe to orders table changes. Edits made by other
  // users (or other tabs of the same user) flow into the store
  // automatically — no manual refresh needed.
  useRealtimeOrders({
    onInsert: (row) => {
      if (row.type === "warranty") {
        setWarranties((prev) =>
          prev.some((o) => o.id === row.id) ? prev : [row, ...prev],
        );
      } else {
        setOrders((prev) =>
          prev.some((o) => o.id === row.id) ? prev : [row, ...prev],
        );
      }
    },
    onUpdate: (row) => {
      const setter = row.type === "warranty" ? setWarranties : setOrders;
      setter((prev) => prev.map((o) => (o.id === row.id ? row : o)));
    },
    onDelete: (id) => {
      setOrders((prev) => prev.filter((o) => o.id !== id));
      setWarranties((prev) => prev.filter((o) => o.id !== id));
    },
    onReconnect: () => {
      // On reconnect, do nothing for now — events missed during a brief
      // disconnect are rare and idempotent merges handle most cases.
      // Phase 2 may add an explicit refetch here.
    },
  });

  // Track who else is signed in right now. Powers the green-ring online
  // indicator on team-member avatars.
  const onlineUsers = usePresence();

  const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const addOrder = useCallback(async (partial: Partial<Order> & { type: "order" | "warranty" }) => {
    const res = await apiCall("/api/orders", "POST", {
      type: partial.type, name: partial.name, detail: partial.detail,
      sku: partial.sku, source: partial.source, member: partial.member, notes: partial.notes,
      internal_notes: partial.internal_notes,
      door_style: partial.door_style, color: partial.color, sku_items: partial.sku_items,
      vendor: partial.vendor, ship_to: partial.ship_to,
      customer_phone: partial.customer_phone, customer_email: partial.customer_email,
      delivery_method: partial.delivery_method,
    });
    if (res?.data) {
      const newItem = shapeOrder(res.data);
      if (partial.type === "order") setOrders(prev => [newItem, ...prev]);
      else setWarranties(prev => [newItem, ...prev]);
    } else {
      const t = today();
      const isOrder = partial.type === "order";
      const newItem: Order = {
        id: isOrder ? `ORD-${Date.now()}` : `WRN-${String(Date.now()).slice(-4)}`,
        type: partial.type, name: partial.name || "Unknown",
        source: (partial.source as Source) || "Manual",
        detail: partial.detail || "—",
        stage: isOrder ? ORDER_STAGES[0] : WARRANTY_STAGES[0],
        member: (partial.member as Member) || "AX",
        date: t, sku: partial.sku || "—", notes: partial.notes || "",
        activity: [{ text: "Order logged", time: t }], archived: false,
      };
      if (isOrder) setOrders(prev => [newItem, ...prev]);
      else setWarranties(prev => [newItem, ...prev]);
    }
  }, []);

  const moveStage = useCallback(async (
    id: string,
    stage: Stage,
    enteredByName?: string,
    adminPin?: string,
  ): Promise<{ ok: boolean; pinRequired?: boolean; error?: string }> => {
    const t = today();

    // Snapshot the orders BEFORE the optimistic update so we can revert
    // exactly if the server rejects. We snapshot from the setter callback
    // (rather than the closed-over `orders`) to be sure we capture the
    // freshest state — older versions of this code lost concurrent
    // updates that landed between render and the click.
    let ordersBefore: Order[] = [];
    let warrantiesBefore: Order[] = [];
    setOrders(prev => { ordersBefore = prev; return prev; });
    setWarranties(prev => { warrantiesBefore = prev; return prev; });

    // Compute the local clear-fields mirror of what the server will do on
    // a backward move. Without this, the UI would briefly show stale dates
    // until the next data refresh pulled them back as null.
    const targetOrder = ordersBefore.find(o => o.id === id)
      ?? warrantiesBefore.find(o => o.id === id);
    const cleared = targetOrder
      ? fieldsToClearOnBackwardMove(targetOrder.stage, stage)
      : null;

    const update = (list: Order[]) => list.map(o =>
      o.id === id ? {
        ...o,
        stage,
        claimed_by: stage !== "New" ? null : o.claimed_by,
        entered_by: stage === "Entered"
          ? (enteredByName ?? o.entered_by)
          : (cleared && "entered_by" in cleared ? null : o.entered_by),
        // Mirror the server's date-clearing so calendar / SLA panels don't
        // briefly flash with stale dates.
        delivery_date:
          cleared && "delivery_date" in cleared ? null : o.delivery_date,
        scheduled_delivery_date:
          cleared && "scheduled_delivery_date" in cleared ? null : o.scheduled_delivery_date,
        delivery_window:
          cleared && "delivery_window" in cleared ? "" : o.delivery_window,
        delivery_notes:
          cleared && "delivery_notes" in cleared ? "" : o.delivery_notes,
        production_start_date:
          cleared && "production_start_date" in cleared ? null : o.production_start_date,
        production_est_finish_date:
          cleared && "production_est_finish_date" in cleared ? null : o.production_est_finish_date,
        activity: [...o.activity, { text: `Moved to "${stage}"`, time: t }]
      } : o
    );
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));

    // Use fetch directly here (not the generic apiCall) so we can read the
    // 403 body and surface `admin_pin_required` to the caller — apiCall
    // swallows non-2xx as `null`.
    let res: Response;
    try {
      res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminPin ? { stage, admin_pin: adminPin } : { stage }),
      });
    } catch {
      // Network error — revert the optimistic update so the UI doesn't lie
      // about state we never persisted.
      setOrders(ordersBefore);
      setWarranties(warrantiesBefore);
      return { ok: false, error: "network_error" };
    }

    if (res.ok) return { ok: true };

    // Server rejected — revert everything we did optimistically. Without
    // this, the order appears moved for a few seconds and then snaps back
    // when the next data refresh pulls the true state from the server.
    setOrders(ordersBefore);
    setWarranties(warrantiesBefore);

    // Parse the error body so callers can branch on `admin_pin_required`.
    let payload: { error?: string; message?: string } = {};
    try { payload = await res.json(); } catch { /* leave empty */ }

    return {
      ok: false,
      pinRequired: payload.error === "admin_pin_required",
      error: payload.error ?? payload.message ?? `HTTP ${res.status}`,
    };
  }, []);

  const updateNotes = useCallback(async (id: string, notes: string) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, notes } : o);
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { notes });
  }, []);

  const updateInternalNotes = useCallback(async (id: string, internal_notes: string) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, internal_notes } : o);
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { internal_notes });
  }, []);

  const archiveOrder = useCallback(async (id: string) => {
    const t = today();
    const update = (list: Order[]) => list.map(o =>
      o.id === id ? { ...o, archived: true, activity: [...o.activity, { text: "Moved to archive", time: t }] } : o
    );
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { archived: true });
  }, []);

  const unarchiveOrder = useCallback(async (id: string) => {
    const t = today();
    const update = (list: Order[]) => list.map(o =>
      o.id === id ? { ...o, archived: false, activity: [...o.activity, { text: "Restored from archive", time: t }] } : o
    );
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { archived: false });
  }, []);

  const updateOrderDetails = useCallback(async (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[]; production_start_date?: string | null; production_est_finish_date?: string | null; scheduled_delivery_date?: string | null }) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, ...details } : o);
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", details);
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    setOrders(prev => prev.filter(o => o.id !== id));
    setWarranties(prev => prev.filter(o => o.id !== id));
    await apiCall(`/api/orders/${id}`, "DELETE");
  }, []);

  const bulkAction = useCallback(async (
    ids: string[],
    action: { type: "move"; stage: Stage; adminPin?: string } | { type: "archive"; archived: boolean }
  ) => {
    // No optimistic update for bulk moves — gate failures (missing
    // attachments, etc.) are common enough that flicker would be worse than
    // a small delay. We refresh from the server after the response.
    const payload = action.type === "move"
      ? { ids, action: "move", stage: action.stage, admin_pin: action.adminPin }
      : { ids, action: "archive", archived: action.archived };

    // Direct fetch instead of apiCall — we need to inspect the response on
    // non-2xx so the UI can prompt for PIN when the server says it's needed.
    let res: Response;
    try {
      res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return null; // network error
    }

    let data: { ok?: boolean; succeeded?: number; failed?: number; results?: { id: string; ok: boolean; error?: string }[]; error?: string } = {};
    try { data = await res.json(); } catch { /* leave as empty */ }

    // 403 with admin_pin_required → tell caller to prompt for PIN
    if (res.status === 403 && data.error === "admin_pin_required") {
      return {
        succeeded: 0,
        failed: ids.length,
        results: [],
        pinRequired: true,
      };
    }

    if (!res.ok) {
      return null;
    }

    // Always refresh from server so local state matches reality. This is
    // simpler and safer than trying to reconcile per-row optimistic updates.
    const [ordersRes, warrantiesRes] = await Promise.all([
      apiCall("/api/orders?type=order"),
      apiCall("/api/orders?type=warranty"),
    ]);
    if (ordersRes?.data) setOrders(ordersRes.data.map(shapeOrder));
    if (warrantiesRes?.data) setWarranties(warrantiesRes.data.map(shapeOrder));

    return {
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      results: data.results ?? [],
    };
  }, []);

  const claimOrder = useCallback(async (id: string, claimedBy: string | null) => {
    // Snapshot previous value so we can revert on failure
    const prev = [...orders, ...warranties].find(o => o.id === id)?.claimed_by ?? null;
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, claimed_by: claimedBy } : o);
    setOrders(prev2 => update(prev2));
    setWarranties(prev2 => update(prev2));
    const res = await apiCall(`/api/orders/${id}`, "PATCH", { claimed_by: claimedBy });
    if (!res) {
      // API failed — revert optimistic update
      const revert = (list: Order[]) => list.map(o => o.id === id ? { ...o, claimed_by: prev } : o);
      setOrders(prev2 => revert(prev2));
      setWarranties(prev2 => revert(prev2));
      return false;
    }
    return true;
  }, [orders, warranties]);

  const addTeamMember = useCallback(async (m: Omit<TeamMember, "id">) => {
    const res = await apiCall("/api/team", "POST", {
      name: m.name, username: m.username, initials: m.initials,
      role: m.role, avatarColor: m.avatarColor,
    });
    if (res?.data) setTeam(prev => [...prev, shapeTeamMember(res.data)]);
    else setTeam(prev => [...prev, { ...m, id: `local-${Date.now()}` }]);
  }, []);

  const updateTeamMember = useCallback(async (id: string, updates: Partial<TeamMember> & { password?: string }) => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
    const res = await apiCall(`/api/team/${id}`, "PATCH", {
      name: updates.name, username: updates.username, initials: updates.initials,
      role: updates.role, avatarColor: updates.avatarColor,
      active: updates.active, password: updates.password,
    });
    if (res?.ok) {
      const teamRes = await apiCall("/api/team");
      if (teamRes?.data) setTeam(teamRes.data.map(shapeTeamMember));
    }
  }, []);

  const deactivateTeamMember = useCallback(async (id: string) => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, active: false } : m));
    await apiCall(`/api/team/${id}`, "PATCH", { active: false });
  }, []);

  const deleteTeamMember = useCallback(async (id: string) => {
    setTeam(prev => prev.filter(m => m.id !== id));
    await apiCall(`/api/team/${id}?hard=true`, "DELETE");
  }, []);

  return (
    <Store.Provider value={{
      orders, warranties, team, onlineUsers, loading,
      addOrder, moveStage, updateNotes, updateInternalNotes, updateOrderDetails, archiveOrder, unarchiveOrder, deleteOrder, bulkAction,
      claimOrder, addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember,
    }}>
      {children}
    </Store.Provider>
  );
}

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
