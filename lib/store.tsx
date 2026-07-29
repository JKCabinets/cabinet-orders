"use client";

import React, {
  createContext, useContext, useState, useMemo,
  useCallback, useEffect, useRef, ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import {
  Order, OrderType, Stage, TeamMember,
  Member, Source, ORDER_STAGES, WARRANTY_STAGES, AvatarColor, Role,
  ID_PREFIX_BY_TYPE,
} from "./data";
import { fieldsToClearOnBackwardMove } from "./stageLogic";
import { useRealtimeOrders } from "./useRealtimeOrders";
import { usePresence } from "./usePresence";

interface StoreCtx {
  orders: Order[];
  warranties: Order[];
  samples: Order[];
  customs: Order[];
  team: TeamMember[];
  onlineUsers: string[];
  loading: boolean;
  addOrder: (o: Partial<Order> & { type: OrderType }) => Promise<void>;
  moveStage: (id: string, stage: Stage, enteredByName?: string, adminPin?: string, overrideAck?: boolean) => Promise<{ ok: boolean; pinRequired?: boolean; error?: string }>;
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
  /**
   * Claim or release the order. When `claimedBy` is non-null, attempts
   * to claim; when null, releases. Returns the actual server state so
   * the caller can show appropriate UI on conflict:
   *   ok=false, claimedBy="aaron"  → Aaron already owns it; show toast
   *   ok=false, claimedBy=null     → generic failure
   *   ok=true,  claimedBy="me"     → you got it
   *   ok=true,  claimedBy=null     → release succeeded
   */
  claimOrder: (
    id: string,
    claimedBy: string | null,
  ) => Promise<{ ok: boolean; claimedBy: string | null; reason?: string }>;
  addTeamMember: (m: Omit<TeamMember, "id">) => Promise<{ ok: boolean; error?: string; temporaryPassword?: string }>;
  updateTeamMember: (id: string, updates: Partial<TeamMember> & { password?: string }) => Promise<{ ok: boolean; error?: string }>;
  deactivateTeamMember: (id: string) => Promise<void>;
  deleteTeamMember: (id: string) => Promise<void>;

  // Profile-only updates (self OR admin; see lib/auth.ts requireSelfOrAdmin)
  updateTeamMemberProfile: (
    id: string,
    fields: Partial<Pick<TeamMember,
      "photoUrl" | "phone" | "email" | "roleTitle" | "bio" |
      "workingHours" | "timezone" | "slackHandle" |
      "oooStatus" | "oooMessage" | "oooUntil"
    >>
  ) => Promise<void>;
  // Upload a new profile photo, returns the new public URL
  uploadAvatar: (id: string, file: File) => Promise<string>;
}

const Store = createContext<StoreCtx | null>(null);

async function apiCall(url: string, method = "GET", body?: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Preserve the server\'s error message so callers can surface it
      // instead of silently swallowing the failure. Falls back to the
      // HTTP status text if the body isn\'t JSON.
      let message = res.statusText || `Request failed (${res.status})`;
      try {
        const errBody = await res.json();
        if (errBody?.error) message = String(errBody.error);
      } catch { /* non-JSON error body */ }
      return { __error: message };
    }
    return await res.json();
  } catch (err) {
    return { __error: err instanceof Error ? err.message : "Network error" };
  }
}

function shapeOrder(raw: Record<string, unknown>): Order {
  return {
    id: raw.id as string,
    type: (raw.type as OrderType) ?? "order",
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
    needs_review: (raw.needs_review as boolean) ?? false,
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

// ID_PREFIX_BY_TYPE now lives in lib/data.ts, shared with the API insert
// in app/api/orders/route.ts so the two cannot drift apart.

/**
 * Replace the rows of each successfully-fetched type, leaving every other
 * type untouched.
 *
 * This preserves the old per-list `if (res?.data)` behaviour: a type whose
 * fetch failed keeps whatever rows it already had rather than being wiped
 * to empty. Order WITHIN a type is preserved (the API's ordering), and
 * order across types is irrelevant because consumers filter by type.
 */
function mergeFetched(
  prev: Order[],
  fetched: { type: string; res?: { data?: Record<string, unknown>[] } | null }[],
): Order[] {
  let next = prev;
  for (const { type, res } of fetched) {
    if (!res?.data) continue;
    next = [...next.filter(o => o.type !== type), ...res.data.map(shapeOrder)];
  }
  return next;
}

function shapeTeamMember(raw: Record<string, unknown>): TeamMember {
  // Map snake_case DB columns to camelCase TS fields. The raw object
  // might come from either:
  //   - Supabase SELECT (always snake_case)
  //   - Our own API after a PATCH (we might pass camelCase echoes back)
  // so each field tolerates both via `?? raw.camelCase` fallbacks.
  return {
    id: raw.id as string,
    username: raw.username as string,
    name: raw.name as string,
    initials: raw.initials as string,
    role: (raw.role as Role) ?? "member",
    avatarColor: ((raw.avatar_color ?? raw.avatarColor) as AvatarColor) ?? "blue",
    active: (raw.active as boolean) ?? true,

    // Profile fields (v15)
    photoUrl:     (raw.photo_url     ?? raw.photoUrl     ?? null) as string | null,
    phone:        (raw.phone                              ?? null) as string | null,
    email:        (raw.email                              ?? null) as string | null,
    roleTitle:    (raw.role_title    ?? raw.roleTitle    ?? null) as string | null,
    bio:          (raw.bio                                ?? null) as string | null,
    workingHours: (raw.working_hours ?? raw.workingHours ?? null) as string | null,
    timezone:     (raw.timezone                           ?? null) as string | null,
    slackHandle:  (raw.slack_handle  ?? raw.slackHandle  ?? null) as string | null,
    oooStatus:    (raw.ooo_status    ?? raw.oooStatus    ?? false) as boolean,
    oooMessage:   (raw.ooo_message   ?? raw.oooMessage   ?? null) as string | null,
    oooUntil:     (raw.ooo_until     ?? raw.oooUntil     ?? null) as string | null,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  // ONE array for every row of the `orders` table, whatever its type.
  // The per-type lists below are derived, not stored. Previously `orders`
  // and `warranties` were separate useState arrays, so every mutation had
  // to write to both -- twenty paired setter calls, each a place a new
  // type could be forgotten. Adding a type is now one useMemo line.
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const orders     = useMemo(() => allOrders.filter(o => o.type === "order"),    [allOrders]);
  const warranties = useMemo(() => allOrders.filter(o => o.type === "warranty"), [allOrders]);
  const samples    = useMemo(() => allOrders.filter(o => o.type === "sample"),   [allOrders]);
  const customs    = useMemo(() => allOrders.filter(o => o.type === "custom"),   [allOrders]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Shared loader for orders/warranties/team. Used by the initial mount
  // (which shows the spinner) and by realtime reconnect (a background
  // catch-up that must NOT flip the spinner or flash the board). An
  // in-flight guard keeps a flurry of reconnects from stacking refetches.
  const refetchInFlight = useRef(false);
  const refetchAll = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (refetchInFlight.current) return;
    refetchInFlight.current = true;
    if (opts?.showLoading) setLoading(true);
    try {
      const [ordersRes, warrantiesRes, samplesRes, customsRes, teamRes] = await Promise.all([
        apiCall("/api/orders?type=order"),
        apiCall("/api/orders?type=warranty"),
        apiCall("/api/orders?type=sample"),
        apiCall("/api/orders?type=custom"),
        apiCall("/api/team"),
      ]);
      setAllOrders(prev => mergeFetched(prev, [
        { type: "order",    res: ordersRes },
        { type: "warranty", res: warrantiesRes },
        { type: "sample",   res: samplesRes },
        { type: "custom",   res: customsRes },
      ]));
      if (teamRes?.data) setTeam(teamRes.data.map(shapeTeamMember));
    } finally {
      if (opts?.showLoading) setLoading(false);
      refetchInFlight.current = false;
    }
  }, []);

  // Only load data once session is authenticated
  useEffect(() => {
    if (status !== "authenticated") return;
    refetchAll({ showLoading: true });
  }, [status, refetchAll]);

  // Realtime: subscribe to orders table changes. Edits made by other
  // users (or other tabs of the same user) flow into the store
  // automatically — no manual refresh needed.
  useRealtimeOrders({
    // No type routing here any more. One array holds every type, so a
    // sample or custom row inserted by another tab lands correctly
    // without these handlers knowing those types exist.
    onInsert: (row) => {
      setAllOrders((prev) =>
        prev.some((o) => o.id === row.id) ? prev : [row, ...prev],
      );
    },
    onUpdate: (row) => {
      setAllOrders((prev) => prev.map((o) => (o.id === row.id ? row : o)));
    },
    onDelete: (id) => {
      setAllOrders((prev) => prev.filter((o) => o.id !== id));
    },
    onReconnect: () => {
      // Catch up on anything missed while disconnected. Background refetch —
      // no spinner, idempotent with the live merges above.
      void refetchAll();
    },
  });

  // Track who else is signed in right now. Powers the green-ring online
  // indicator on team-member avatars.
  const onlineUsers = usePresence();

  const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const addOrder = useCallback(async (partial: Partial<Order> & { type: OrderType }) => {
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
      setAllOrders(prev => [newItem, ...prev]);
    } else {
      // NOTE: this fabricates a local row after a FAILED post, so it
      // disappears on the next refetch. Same anti-pattern addTeamMember
      // was fixed for (see its comment). Preserved verbatim here --
      // removing it is a behaviour change and deserves its own commit.
      const t = today();
      const isWarranty = partial.type === "warranty";
      const newItem: Order = {
        // Warranty ids keep their existing 4-digit short form.
        id: isWarranty
          ? `WRN-${String(Date.now()).slice(-4)}`
          : `${ID_PREFIX_BY_TYPE[partial.type] ?? "ORD"}-${Date.now()}`,
        type: partial.type, name: partial.name || "Unknown",
        source: (partial.source as Source) || "Manual",
        detail: partial.detail || "—",
        // Only warranties start outside the order flow. Samples and
        // custom orders both start at "New" -- ORDER_STAGES[0] for a
        // sample, CUSTOM_STAGES[0] for a custom order, same string.
        stage: isWarranty ? WARRANTY_STAGES[0] : ORDER_STAGES[0],
        member: (partial.member as Member) || "AX",
        date: t, sku: partial.sku || "—", notes: partial.notes || "",
        activity: [{ text: "Order logged", time: t }], archived: false,
      };
      setAllOrders(prev => [newItem, ...prev]);
    }
  }, []);

  const moveStage = useCallback(async (
    id: string,
    stage: Stage,
    enteredByName?: string,
    adminPin?: string,
    overrideAck?: boolean,
  ): Promise<{ ok: boolean; pinRequired?: boolean; error?: string }> => {
    const t = today();

    // Snapshot the orders BEFORE the optimistic update so we can revert
    // exactly if the server rejects. We snapshot from the setter callback
    // (rather than the closed-over `orders`) to be sure we capture the
    // freshest state — older versions of this code lost concurrent
    // updates that landed between render and the click.
    let allBefore: Order[] = [];
    setAllOrders(prev => { allBefore = prev; return prev; });

    // Compute the local clear-fields mirror of what the server will do on
    // a backward move. Without this, the UI would briefly show stale dates
    // until the next data refresh pulled them back as null.
    const targetOrder = allBefore.find(o => o.id === id);
    // Pass the row's type. Stage names are shared across flows now, so
    // resolving "Delivered" blind would use the ORDER index for a custom
    // order and clear the wrong fields.
    const cleared = targetOrder
      ? fieldsToClearOnBackwardMove(targetOrder.stage, stage, targetOrder.type)
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
    setAllOrders(prev => update(prev));

    // Use fetch directly here (not the generic apiCall) so we can read the
    // 403 body and surface `admin_pin_required` to the caller — apiCall
    // swallows non-2xx as `null`.
    let res: Response;
    try {
      res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, ...(adminPin ? { admin_pin: adminPin } : {}), ...(overrideAck ? { override_ack: true } : {}) }),
      });
    } catch {
      // Network error — revert the optimistic update so the UI doesn't lie
      // about state we never persisted.
      setAllOrders(allBefore);
      return { ok: false, error: "network_error" };
    }

    if (res.ok) return { ok: true };

    // Server rejected — revert everything we did optimistically. Without
    // this, the order appears moved for a few seconds and then snaps back
    // when the next data refresh pulls the true state from the server.
    setAllOrders(allBefore);

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
    setAllOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { notes });
  }, []);

  const updateInternalNotes = useCallback(async (id: string, internal_notes: string) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, internal_notes } : o);
    setAllOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { internal_notes });
  }, []);

  const archiveOrder = useCallback(async (id: string) => {
    const t = today();
    const update = (list: Order[]) => list.map(o =>
      o.id === id ? { ...o, archived: true, activity: [...o.activity, { text: "Moved to archive", time: t }] } : o
    );
    setAllOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { archived: true });
  }, []);

  const unarchiveOrder = useCallback(async (id: string) => {
    const t = today();
    const update = (list: Order[]) => list.map(o =>
      o.id === id ? { ...o, archived: false, activity: [...o.activity, { text: "Restored from archive", time: t }] } : o
    );
    setAllOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { archived: false });
  }, []);

  const updateOrderDetails = useCallback(async (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[]; production_start_date?: string | null; production_est_finish_date?: string | null; scheduled_delivery_date?: string | null }) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, ...details } : o);
    setAllOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", details);
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    setAllOrders(prev => prev.filter(o => o.id !== id));
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
    const [ordersRes, warrantiesRes, samplesRes, customsRes] = await Promise.all([
      apiCall("/api/orders?type=order"),
      apiCall("/api/orders?type=warranty"),
      apiCall("/api/orders?type=sample"),
      apiCall("/api/orders?type=custom"),
    ]);
    setAllOrders(prev => mergeFetched(prev, [
      { type: "order",    res: ordersRes },
      { type: "warranty", res: warrantiesRes },
      { type: "sample",   res: samplesRes },
      { type: "custom",   res: customsRes },
    ]));

    return {
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      results: data.results ?? [],
    };
  }, []);

  const claimOrder = useCallback(async (id: string, claimedBy: string | null) => {
    // Optimistically update local state, then call the dedicated
    // /api/orders/[id]/claim endpoint which delegates to the atomic
    // SQL function. If the server reports a different state than we
    // assumed (e.g. someone else already had it), reconcile.
    const prev = allOrders.find(o => o.id === id)?.claimed_by ?? null;

    const optimistic = (list: Order[]) =>
      list.map(o => (o.id === id ? { ...o, claimed_by: claimedBy } : o));
    setAllOrders(prev2 => optimistic(prev2));

    try {
      const res = await fetch(`/api/orders/${id}/claim`, {
        method: claimedBy ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));

      // Reconcile local state with whatever the server actually says
      const serverClaimedBy = (body?.claimed_by ?? null) as string | null;
      const reconcile = (list: Order[]) =>
        list.map(o => (o.id === id ? { ...o, claimed_by: serverClaimedBy } : o));
      setAllOrders(prev2 => reconcile(prev2));

      if (!res.ok || body?.ok === false) {
        return {
          ok: false,
          claimedBy: serverClaimedBy,
          reason: (body?.reason as string | undefined) ?? "request_failed",
        };
      }
      return { ok: true, claimedBy: serverClaimedBy };
    } catch (err) {
      // Network failure — revert to whatever was there before
      const revert = (list: Order[]) =>
        list.map(o => (o.id === id ? { ...o, claimed_by: prev } : o));
      setAllOrders(prev2 => revert(prev2));
      return { ok: false, claimedBy: prev, reason: "network_error" };
    }
  }, [allOrders]);

  const addTeamMember = useCallback(async (m: Omit<TeamMember, "id">): Promise<{ ok: boolean; error?: string; temporaryPassword?: string }> => {
    const res = await apiCall("/api/team", "POST", {
      name: m.name, username: m.username, initials: m.initials,
      role: m.role, avatarColor: m.avatarColor,
    });
    // Only add to local state on a real DB-backed success. On failure we
    // surface the error to the caller and add NOTHING — no fabricated
    // `local-` row that would vanish on the next refetch (that masked a
    // NOT-NULL constraint failure for a long time).
    if (res?.data) {
      setTeam(prev => [...prev, shapeTeamMember(res.data)]);
      return { ok: true, temporaryPassword: res.temporary_password };
    }
    return { ok: false, error: res?.__error ?? "Failed to add member" };
  }, []);

  const updateTeamMember = useCallback(async (id: string, updates: Partial<TeamMember> & { password?: string }): Promise<{ ok: boolean; error?: string }> => {
    // Snapshot prior state so we can roll back the optimistic update if
    // the server rejects the change (e.g. weak password -> 422).
    let prevSnapshot: TeamMember[] = [];
    setTeam(prev => { prevSnapshot = prev; return prev.map(m => m.id === id ? { ...m, ...updates } : m); });
    const res = await apiCall(`/api/team/${id}`, "PATCH", {
      name: updates.name, username: updates.username, initials: updates.initials,
      role: updates.role, avatarColor: updates.avatarColor,
      active: updates.active, password: updates.password,
    });
    // apiCall returns { __error } on failure, or the parsed body on success.
    if (res?.__error) {
      // Roll back the optimistic change and report the real error.
      setTeam(prevSnapshot);
      return { ok: false, error: res.__error };
    }
    // Reconcile against the server's authoritative state.
    const teamRes = await apiCall("/api/team");
    if (teamRes?.data) setTeam(teamRes.data.map(shapeTeamMember));
    return { ok: true };
  }, []);

  const deactivateTeamMember = useCallback(async (id: string) => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, active: false } : m));
    await apiCall(`/api/team/${id}`, "PATCH", { active: false });
  }, []);

  /**
   * PATCH profile-only fields. Distinct from updateTeamMember because:
   *   - The API gates these fields with requireSelfOrAdmin (vs admin-only)
   *   - We never need to refetch the whole team after — just merge locally
   *   - Photo upload happens separately via uploadAvatar; photoUrl here
   *     is the URL string already returned from that upload
   */
  const updateTeamMemberProfile = useCallback(async (
    id: string,
    fields: Partial<Pick<TeamMember,
      "photoUrl" | "phone" | "email" | "roleTitle" | "bio" |
      "workingHours" | "timezone" | "slackHandle" |
      "oooStatus" | "oooMessage" | "oooUntil"
    >>
  ) => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, ...fields } : m));
    await apiCall(`/api/team/${id}`, "PATCH", fields);
  }, []);

  /**
   * POST a photo to /api/team/[id]/avatar. Returns the new public URL.
   * Updates local team state so any avatar rendered elsewhere on the
   * page picks up the new photo without a refetch.
   */
  const uploadAvatar = useCallback(async (id: string, file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/team/${id}/avatar`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Upload failed");
    }
    const data = await res.json();
    setTeam(prev => prev.map(m => m.id === id ? { ...m, photoUrl: data.url } : m));
    return data.url as string;
  }, []);

  const deleteTeamMember = useCallback(async (id: string) => {
    setTeam(prev => prev.filter(m => m.id !== id));
    await apiCall(`/api/team/${id}?hard=true`, "DELETE");
  }, []);

  return (
    <Store.Provider value={{
      orders, warranties, samples, customs, team, onlineUsers, loading,
      addOrder, moveStage, updateNotes, updateInternalNotes, updateOrderDetails, archiveOrder, unarchiveOrder, deleteOrder, bulkAction,
      claimOrder, addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember,
      updateTeamMemberProfile, uploadAvatar,
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
