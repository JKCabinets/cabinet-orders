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

interface StoreCtx {
  orders: Order[];
  warranties: Order[];
  team: TeamMember[];
  loading: boolean;
  addOrder: (o: Partial<Order> & { type: "order" | "warranty" }) => Promise<void>;
  moveStage: (id: string, stage: Stage) => Promise<void>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  archiveOrder: (id: string) => Promise<void>;
  unarchiveOrder: (id: string) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  updateOrderDetails: (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[] }) => Promise<void>;
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
    archived: (raw.archived as boolean) ?? false,
    activity: (raw.activity as { text: string; time: string }[]) ?? [],
    door_style: (raw.door_style as string) ?? "",
    color: (raw.color as string) ?? "",
    sku_items: (raw.sku_items as { sku: string; quantity: number; description?: string }[]) ?? [],
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

  const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const addOrder = useCallback(async (partial: Partial<Order> & { type: "order" | "warranty" }) => {
    const res = await apiCall("/api/orders", "POST", {
      type: partial.type, name: partial.name, detail: partial.detail,
      sku: partial.sku, source: partial.source, member: partial.member, notes: partial.notes,
      door_style: partial.door_style, color: partial.color, sku_items: partial.sku_items,
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

  const moveStage = useCallback(async (id: string, stage: Stage) => {
    const t = today();
    const update = (list: Order[]) => list.map(o =>
      o.id === id ? { ...o, stage, activity: [...o.activity, { text: `Moved to "${stage}"`, time: t }] } : o
    );
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { stage });
  }, []);

  const updateNotes = useCallback(async (id: string, notes: string) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, notes } : o);
    setOrders(prev => update(prev));
    setWarranties(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { notes });
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

  const updateOrderDetails = useCallback(async (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[] }) => {
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
      orders, warranties, team, loading,
      addOrder, moveStage, updateNotes, updateOrderDetails, archiveOrder, unarchiveOrder, deleteOrder,
      addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember,
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
