"use client";

import React, {
  createContext, useContext, useState, useMemo,
  useCallback, useEffect, useRef, ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import {
  Order, OrderType, Stage, TeamMember,
  AvatarColor, Role,
  ORDER_TYPES, shapeOrder, withPurchasePayment, activityDate,
  type Project,
  withStageEvent, withCreationEvent,
} from "./data";
// (2026-10-14) Member, Source, ORDER_STAGES, WARRANTY_STAGES and
// ID_PREFIX_BY_TYPE left this import with the row addOrder used to fabricate
// after a failed create; nothing else here read them.
import { fieldsToClearOnBackwardMove } from "./stageLogic";
import { useRealtimeOrders, useRealtimeProjects, useRealtimeActivity, useRealtimeAttachments } from "./useRealtimeOrders";
import { attachmentsChanged, attachmentRemoved, refreshShownAttachments } from "./attachments";
import { usePresence } from "./usePresence";

/** What archiveOrder and unarchiveOrder resolve with. */
export interface ArchiveResult {
  ok: boolean;
  /** The server's error code, or "network_error". */
  error?: string;
  /** The server's own sentence, when it sent one. Meant for a toast. */
  message?: string;
}

/**
 * What addOrder resolves with (2026-10-14). Until then it resolved with
 * nothing, so no caller could tell a created job from a refused one -- and on
 * a refusal the store made one up (see addOrder).
 */
/** One item of a member's OPEN work, as member_open_work() lists it (2026-10-19). */
export interface MemberWorkItem {
  kind: "project" | "job" | "claim" | "submission";
  id: string;
  label: string;
}

/** What deactivating or deleting a member did to their open work (2026-10-19). */
export interface ClaimsOutcome {
  moved: { kind: string; id: string; to: string }[];
  released: { kind: string; id: string }[];
  /** Handed on in the dialog, but taken by someone else before the delete ran. */
  not_held: string[];
}

export interface AddOrderResult {
  ok: boolean;
  /** The row the server created, shaped. Present when ok. */
  order?: Order;
  /** The server's error code or text, or the network's. */
  error?: string;
  /** The server's own sentence, when it sent one. Meant for the person. */
  message?: string;
}

interface StoreCtx {
  /**
   * Every row of the `orders` table, regardless of type. A consumer that
   * holds an Order and wants its LIVE counterpart must search this, not
   * one of the per-type lists below -- OrderModal used to pick between
   * `orders` and `warranties` from a prop, which silently fell back to a
   * stale snapshot for any row in neither.
   */
  allOrders: Order[];
  orders: Order[];
  warranties: Order[];
  samples: Order[];
  customs: Order[];
  hardware: Order[];
  /** Keyed by id. Empty for standalone rows -- custom jobs and warranty
   *  claims have no project. */
  projects: Record<string, Project>;
  team: TeamMember[];
  onlineUsers: string[];
  loading: boolean;
  /** Creates a custom job or a warranty claim. Nothing is added locally
   *  unless the server created the row; a refusal is returned, not hidden. */
  addOrder: (o: Partial<Order> & { type: OrderType }) => Promise<AddOrderResult>;
  /** `overrideAck` is the REASON for skipping the acknowledgment gate, not a
   *  flag: the route refuses an empty one and writes it to the activity
   *  trail. Same contract as `overrideDeliveryProof`. */
  moveStage: (id: string, stage: Stage, enteredByName?: string, adminPin?: string, overrideAck?: string, overrideDeliveryProof?: string) => Promise<{ ok: boolean; pinRequired?: boolean; error?: string }>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  updateInternalNotes: (id: string, internal_notes: string) => Promise<void>;
  /** Groups whose PROJECT is archived are NOT in `allOrders`. This is. */
  allOrdersIncludingArchived: Order[];
  archiveProject: (id: string, archived: boolean) => Promise<{ ok: boolean; message?: string }>;
  /** Claim or release a whole purchase. Resolves with who holds it. */
  claimProject: (id: string, claim: boolean) => Promise<{ ok: boolean; claimedBy: string | null; reason?: string }>;
  /**
   * Archive or restore ONE standalone row. A refusal has already been reverted
   * locally by the time this resolves. Project-linked groups are archived with
   * their purchase, through `archiveProject`.
   */
  archiveOrder: (id: string) => Promise<ArchiveResult>;
  unarchiveOrder: (id: string) => Promise<ArchiveResult>;
  deleteOrder: (id: string) => Promise<void>;
  /** Close a warranty claim, Approved or Denied (2026-10-13). Resolves with the server's refusal, if any. */
  closeClaim: (id: string, outcome: "approved" | "denied", reason: string) => Promise<ArchiveResult>;
  /** Record consent a customer gave by email, on their purchase (2026-10-13). */
  recordConsent: (projectId: string, conversation: string, agreedAt: string) => Promise<ArchiveResult>;
  bulkAction: (
    ids: string[],
    action: { type: "archive"; archived: boolean } | { type: "delete" }
  ) => Promise<{ succeeded: number; failed: number; results: { id: string; ok: boolean; error?: string }[] } | null>;
  updateOrderDetails: (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[]; production_start_date?: string | null; production_est_finish_date?: string | null; scheduled_delivery_date?: string | null; tracking_number?: string | null }) => Promise<void>;
  /** Name, contact, location -- custom jobs and claims. NOT optimistic: resolves to null when saved, or the server's sentence. */
  updateCustomerDetails: (id: string, details: { name?: string; customer_email?: string; customer_phone?: string; ship_to?: string }) => Promise<string | null>;
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
  /**
   * ⚠ THEY RETURN A RESULT (2026-09-16). Both applied their change locally and
   * discarded the server's answer, so the admin page announced "deactivated"
   * and "deleted" whatever happened -- the same shape as the archive pair
   * before item 10. A refusal is undone here and reported to the caller.
   */
  /** Deactivating releases their open work (2026-10-19); `claims` says what. */
  deactivateTeamMember: (id: string) => Promise<{ ok: boolean; error?: string; claims?: ClaimsOutcome }>;
  /** `assign` hands their open work on, by "kind:id" (2026-10-19); the rest is released. */
  deleteTeamMember: (id: string, assign?: Record<string, string>) => Promise<{ ok: boolean; error?: string; claims?: ClaimsOutcome }>;
  /** What a member holds that is still open: the delete dialog's list. */
  memberOpenWork: (id: string) => Promise<{ ok: boolean; work?: MemberWorkItem[]; error?: string }>;

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
      // The server's sentence as well as its code, when it sends both
      // (2026-10-14): `error` is often a key like type_not_manually_creatable,
      // and `message` is what a person should read. Callers that read only
      // __error are unaffected.
      let sentence: string | undefined;
      try {
        const errBody = await res.json();
        if (errBody?.error) message = String(errBody.error);
        if (typeof errBody?.message === "string" && errBody.message) sentence = errBody.message;
      } catch { /* non-JSON error body */ }
      return sentence ? { __error: message, __message: sentence } : { __error: message };
    }
    return await res.json();
  } catch (err) {
    return { __error: err instanceof Error ? err.message : "Network error" };
  }
}


// ID_PREFIX_BY_TYPE lives in lib/data.ts. The store no longer reads it
// (2026-10-14): the server allocates every id, and a row the server did not
// create is never shown.

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

/**
 * Undo ONE optimistic write on ONE record, field by field.
 *
 * `before` and `after` are the record as the optimistic update found it and as
 * it left it. A field counts as this call's change when the two differ, and it
 * goes back only if `current` still holds the value this call wrote -- so a
 * realtime row or a later local edit that has touched the field since is left
 * standing. A key the update ADDED is removed again rather than left behind as
 * `undefined`.
 *
 * ⚠ WHY NOT RESTORE A SNAPSHOT OF THE ARRAY. moveStage and updateTeamMember
 * did, and took the snapshot inside a setState updater. React runs an updater
 * on the spot only when the component has no update still pending from its
 * last render; otherwise it runs it at the next render. So the snapshot was:
 *
 *   · EMPTY on the line after dispatching -- which is where moveStage looked
 *     the row up to mirror the backward-move clearing, so on a store that had
 *     updated recently the mirror silently never happened;
 *   · the WHOLE ARRAY AS OF THAT RENDER by the time a refusal came back -- so
 *     restoring it undid every change to every other row that had landed
 *     while the request was out, a colleague's realtime edit included;
 *   · still EMPTY if the refusal beat the render, blanking every list.
 *
 * All three demonstrated 2026-09-16 against this file under React 19. The
 * third needs a response faster than React's next render, which a real
 * network does not give; the first two need nothing unusual.
 *
 * ⚠ THE FIELDS ARE DERIVED, NOT LISTED. A hand-kept list of "what moveStage
 * writes" is a second copy of the update, and the first field added to one and
 * not the other would stop being reverted without any error.
 */
function undoFields<T extends object>(current: T, before: T, after: T): T {
  const c = current as unknown as Record<string, unknown>;
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...c };
  for (const key of Object.keys(a)) {
    if (key in b && b[key] === a[key]) continue;  // this call did not change it
    if (c[key] !== a[key]) continue;              // written again since
    if (key in b) next[key] = b[key];
    else delete next[key];
  }
  return next as unknown as T;
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
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  // Projects, keyed by id. A Shopify checkout is one project with one
  // `orders` row per product category; the project owns the customer, the
  // address and the money. Custom jobs and warranty claims have no project
  // and simply are not in here.
  const [projects, setProjects] = useState<Record<string, Project>>({});

  /**
   * ⚠ `allOrders` EXCLUDES groups whose PROJECT is archived.
   *
   * Archiving moved up to the project: a Shopify checkout is archived as a
   * whole purchase, and `orders.archived` is deliberately NOT set on its
   * groups -- two columns carrying one fact is two that can disagree, and the
   * second is the one that gets forgotten.
   *
   * The hiding is by LOOKUP, and it happens HERE rather than in each consumer.
   * Every page derives from this array: the order hubs, the work queue, /sla,
   * the dashboard, the calendar. Filtering per consumer is how one rule becomes
   * six implementations, five of which are right -- the bug class this codebase
   * produced four times in six days.
   *
   * Declared AFTER `projects` because it reads it. The first version of this
   * patch put it above and tsc caught the use-before-declaration.
   *
   * `allOrdersIncludingArchived` is the escape hatch, named so that seeing
   * archived work has to be asked for.
   */
  /**
   * Every row with its payment fields resolved through its PROJECT.
   *
   * ⚠ RESOLVED HERE, ONCE (2026-09-16), for the same reason archived purchases
   * are hidden here once. The payment pill, the refund banner and the work
   * queue's hold reason all read `order.payment_status`; resolving it in each
   * would be three copies of "whose status is this". See paymentRecordOf.
   *
   * A Shopify group carries no payment fields of its own (2026-09-16), so its
   * resolved row is a new object whenever its project changes. Consumers key on
   * ids, not on this array's identity (useOrderEnrichment says why), so that
   * costs a recompute, never a refetch.
   */
  const resolvedOrders = useMemo(() => {
    const next = rawOrders.map(o =>
      withPurchasePayment(o, o.project_id ? projects[o.project_id] : undefined));
    return next.every((o, i) => o === rawOrders[i]) ? rawOrders : next;
  }, [rawOrders, projects]);

  const allOrders = useMemo(() => {
    const archivedProjects = new Set(
      Object.values(projects).filter(p => p.archived).map(p => p.id));
    if (archivedProjects.size === 0) return resolvedOrders;
    return resolvedOrders.filter(o => !o.project_id || !archivedProjects.has(o.project_id));
  }, [resolvedOrders, projects]);

  const orders     = useMemo(() => allOrders.filter(o => o.type === "order"),    [allOrders]);
  const warranties = useMemo(() => allOrders.filter(o => o.type === "warranty"), [allOrders]);
  const samples    = useMemo(() => allOrders.filter(o => o.type === "sample"),   [allOrders]);
  const customs    = useMemo(() => allOrders.filter(o => o.type === "custom"),   [allOrders]);
  const hardware   = useMemo(() => allOrders.filter(o => o.type === "hardware"), [allOrders]);
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
      // Fan out over ORDER_TYPES rather than a hardcoded list. This was four
      // literal calls plus a matching four-entry mergeFetched array, in two
      // separate functions -- a copy that drifts the moment a type is added,
      // which is the bug class behind the tag overwrite and the stale
      // realtime shaper. Adding a type is now genuinely one line.
      const [teamRes, projectsRes, ...typeRes] = await Promise.all([
        apiCall("/api/team"),
        apiCall("/api/projects"),
        ...ORDER_TYPES.map(t => apiCall(`/api/orders?type=${t}`)),
      ]);
      if (projectsRes?.data) {
        setProjects(Object.fromEntries(
          (projectsRes.data as Project[]).map((p) => [p.id, p])));
      }
      setRawOrders(prev => mergeFetched(prev,
        ORDER_TYPES.map((type, i) => ({ type, res: typeRes[i] }))));
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
      setRawOrders((prev) =>
        prev.some((o) => o.id === row.id) ? prev : [withCreationEvent(row), ...prev],
      );
    },
    onUpdate: (row) => {
      setRawOrders((prev) => prev.map((o) => {
        if (o.id !== row.id) return o;
        // ⚠ A REALTIME PAYLOAD CANNOT CARRY A JOIN.
        //
        // It is the `orders` row and nothing else, so shapeOrder's
        // `activity: raw.activity ?? []` always yields an EMPTY trail. This
        // replaced the stored row wholesale, so every live update blanked
        // that order's Activity tab until the next full refetch -- and an
        // empty trail is indistinguishable from nothing having been recorded,
        // which is the failure mode this system actually has.
        //
        // Every other mutation in this file merges with `{ ...o, ... }` and
        // keeps the trail. This was the only wholesale replace.
        //
        // ⚠ Stops it going BACKWARDS; new entries arrive through
        // useRealtimeActivity below. (This said nothing subscribed to
        // order_activity. The subscription came on 2026-09-15, but it RECEIVED
        // nothing until 2026-09-30, when the table became readable to the
        // browser's role -- see that hook.) Guarded on length rather than
        // replaced unconditionally, so a caller that ever does supply activity
        // wins.
        //
        // ⚠ STAGE EVENTS LIKEWISE (2026-10-21, item 7): the payload has none, so
        // keep the order's, and append when its stage moved -- at the row's
        // stage_entered_at, which is what the database's trigger recorded.
        return {
          ...row,
          activity: row.activity.length > 0 ? row.activity : o.activity,
          stage_events: row.stage_events.length > 0 ? row.stage_events
            : withStageEvent(o.stage_events, row.stage, row.stage_entered_at),
        };
      }));
    },
    onDelete: (id) => {
      setRawOrders((prev) => prev.filter((o) => o.id !== id));
    },
    onReconnect: () => {
      // Catch up on anything missed while disconnected. Background refetch —
      // no spinner, idempotent with the live merges above.
      void refetchAll();
    },
  });

  // Realtime on projects. Merged into the keyed map rather than an array
  // so an UPDATE is one assignment -- with the project embedded on every
  // group instead, a refund would have to patch each copy.
  /**
   * ⚠ THE OTHER HALF OF THE MERGE ABOVE. That one stops a live order update
   * BLANKING the trail; this one makes new entries actually arrive. Its
   * comment named this gap and it is now closed.
   *
   * ⚠ DEDUPED AGAINST THE OPTIMISTIC APPEND. moveStage and friends push an
   * entry locally before the round-trip, so without this the actor sees
   * their own action twice. Matched on text AND time -- `time` is a DAY
   * string, so two identical texts on one day collapse to one. Entry texts
   * carry a stage and an actor name, which makes that unlikely; the
   * alternative, dropping the optimistic append, would put a round-trip in
   * front of every action's feedback.
   */
  useRealtimeActivity({
    onEntry: (orderId, entry) => {
      setRawOrders((prev) => prev.map((o) => {
        if (o.id !== orderId) return o;
        const already = o.activity.some(
          (a) => a.text === entry.text && a.time === entry.time,
        );
        return already ? o : { ...o, activity: [...o.activity, entry] };
      }));
    },
  });

  useRealtimeProjects({
    onUpsert: (row) => {
      const p = row as unknown as Project;
      if (!p?.id) return;
      setProjects((prev) => ({ ...prev, [p.id]: p }));
    },
    onDelete: (id) => {
      setProjects((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
  });

  // ⚠ FILES ON REALTIME (2026-10-21, item 6). A colleague's upload or delete
  // refetches the file lists ON SCREEN; lib/attachments owns that cache, so the
  // store only routes the events to it.
  useRealtimeAttachments({
    onChange: attachmentsChanged,
    onRemoved: attachmentRemoved,
    onReconnect: refreshShownAttachments,
  });

  // Track who else is signed in right now. Powers the green-ring online
  // indicator on team-member avatars.
  const onlineUsers = usePresence();

  // ⚠ PHOENIX, NOT THE BROWSER'S CLOCK. The optimistic label is replaced by the
  // server's row moments later, and a label that disagreed with it by a day was
  // the same untruth in the other direction. See activityDate.
  const today = () => activityDate();

  const addOrder = useCallback(async (partial: Partial<Order> & { type: OrderType }): Promise<AddOrderResult> => {
    // ⚠ SPREAD, NOT A WHITELIST -- and that is the fix, not laziness.
    //
    // This used to list every field by hand, so a field not named was
    // dropped SILENTLY: no error, the value simply never left the browser.
    // total_price was exactly that for a day, and tsc cannot catch it --
    // the object is built by hand, so a missing key is not a type error.
    //
    // Safe because POST /api/orders builds its own explicit `newOrder`
    // object from the body: keys it does not recognise are ignored, never
    // written. The whitelist protected nothing and cost a field.
    const res = await apiCall("/api/orders", "POST", { ...partial });
    if (!res?.data) {
      // (2026-10-14) A failed create used to FABRICATE a row here -- a made-up
      // id, "Order logged" on its trail -- which sat on the board as if saved
      // until the next refetch. Removed, as addTeamMember's was: nothing is
      // added, and the refusal goes back to the caller to show.
      return { ok: false, error: res?.__error ?? "request_failed", message: res?.__message };
    }
    const created = withCreationEvent(shapeOrder(res.data));
    // ⚠ REALTIME USUALLY GETS HERE FIRST (2026-10-14). The row's INSERT event
    // often arrives before this POST's own answer, and this used to prepend
    // regardless -- so a new job showed TWICE until a reload, while the
    // database held one. One row per id, as onInsert already insists.
    //
    // ⚠ BUT NOT "SKIP IF PRESENT". A realtime row carries no trail
    // (shapeOrder gives it `activity: []`), and its "Order logged by …" entry
    // comes on another channel, in no guaranteed order: if that entry arrives
    // before the row, useRealtimeActivity finds nothing to attach it to and it
    // is lost. So the row already here is kept -- a realtime UPDATE may have
    // landed on it since -- and this answer's entries it lacks are put in
    // front: the creation entry is always the first. Deduped on text and
    // time, as the activity merge is.
    setRawOrders(prev => {
      const existing = prev.find(o => o.id === created.id);
      if (!existing) return [created, ...prev];
      const missing = created.activity.filter(a =>
        !existing.activity.some(e => e.text === a.text && e.time === a.time));
      if (missing.length === 0) return prev;
      return prev.map(o => (o.id === created.id ? { ...o, activity: [...missing, ...o.activity] } : o));
    });
    return { ok: true, order: created };
  }, []);

  const moveStage = useCallback(async (
    id: string,
    stage: Stage,
    enteredByName?: string,
    adminPin?: string,
    overrideAck?: string,
    /** Reason for bypassing the delivery-proof gate. Required by the
     *  server when no receipt is attached; recorded in order_activity. */
    overrideDeliveryProof?: string,
  ): Promise<{ ok: boolean; pinRequired?: boolean; error?: string }> => {
    // ⚠ NO SNAPSHOT OF THE ARRAY (open item 10, fixed 2026-09-16).
    //
    // This took `allBefore` inside a setState updater and read it on the next
    // line, where it was usually still `[]` -- see undoFields for why. So the
    // backward-move clearing below looked the row up in an empty array and
    // never mirrored: stale dates and tracking numbers stayed on screen until
    // realtime replaced the row. And a refusal restored the array as it stood
    // at the next render, undoing any other order's change that had arrived
    // while the request was out.
    //
    // The row is now read INSIDE the updater, where it is guaranteed current,
    // and a refusal undoes this one row with undoFields. `before` and `after`
    // are read only inside the revert's own updater, which React always runs
    // after the optimistic one -- never on the line after dispatching.
    const entry = { text: `Moved to "${stage}"`, time: today(), at: new Date().toISOString() };
    let before: Order | undefined;
    let after: Order | undefined;

    setRawOrders(prev => prev.map(o => {
      if (o.id !== id) return o;
      // Pass the row's type. Stage names are shared across flows, so
      // resolving "Delivered" blind would use the ORDER index for a custom
      // order and clear the wrong fields.
      const cleared = fieldsToClearOnBackwardMove(o.stage, stage, o.type);
      before = o;
      after = {
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
        // ⚠ MIRRORED FOR THE SAME REASON AS THE DATES, and it matters more.
        // Without this the modal re-renders still holding the old number for
        // the moment before realtime lands -- and TrackingEntry pre-fills from
        // it, so Ship re-submits a number the server has already cleared. That
        // window is where the 2026-08-27 bug lived.
        tracking_number:
          cleared && "tracking_number" in cleared ? null : o.tracking_number,
        carrier:
          cleared && "carrier" in cleared ? null : o.carrier,
        activity: [...o.activity, entry],
      };
      return after;
    }));

    const revert = () => setRawOrders(prev => prev.map(o => {
      if (o.id !== id || !before || !after) return o;
      const undone = undoFields(o, before, after);
      // Remove this call's own entry by identity, even if a realtime activity
      // row has since replaced the array undoFields would otherwise restore.
      return { ...undone, activity: undone.activity.filter(a => a !== entry) };
    }));

    // Use fetch directly here (not the generic apiCall) so we can read the
    // 403 body and surface `admin_pin_required` to the caller — apiCall
    // swallows non-2xx as `null`.
    let res: Response;
    try {
      res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          ...(adminPin ? { admin_pin: adminPin } : {}),
          ...(overrideAck ? { override_ack: overrideAck } : {}),
          ...(overrideDeliveryProof ? { override_delivery_proof: overrideDeliveryProof } : {}),
        }),
      });
    } catch {
      // Network error -- undo the optimistic update so the UI doesn't lie
      // about state we never persisted.
      revert();
      return { ok: false, error: "network_error" };
    }

    if (res.ok) return { ok: true };

    // Server refused -- undo this row. Without it the order appears moved
    // until something refetches, and a refusal nobody sees undone reads as
    // the move having worked.
    revert();

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
    setRawOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { notes });
  }, []);

  const updateInternalNotes = useCallback(async (id: string, internal_notes: string) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, internal_notes } : o);
    setRawOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", { internal_notes });
  }, []);


  /**
   * Archive or restore a whole purchase.
   *
   * ⚠ NO OPTIMISTIC UPDATE. The server refuses unless every group is at the
   * last stage of its own flow, or the project is refunded -- so the call can
   * legitimately fail, and a row that vanished then came back would read as a
   * glitch rather than a refusal. The message is returned for the caller.
   *
   * Nothing is written to the group rows: they are hidden because their project
   * is archived, resolved by lookup in `allOrders` above.
   */
  /**
   * Claim or release a project.
   *
   * ⚠ NO OPTIMISTIC UPDATE, unlike claimOrder. The server can refuse -- someone
   * else may hold it, and a non-admin cannot release another person's claim --
   * so a name that appeared and then reverted would read as a glitch rather
   * than a refusal. The endpoint returns WHO holds it, which is the useful part
   * of the failure.
   */
  const claimProject = useCallback(async (
    id: string,
    claim: boolean,
  ): Promise<{ ok: boolean; claimedBy: string | null; reason?: string }> => {
    try {
      const res = await fetch(`/api/projects/${id}/claim`, {
        method: claim ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      const claimedBy = (body?.claimed_by ?? null) as string | null;
      if (res.ok) {
        setProjects(prev => {
          const p = prev[id];
          if (!p) return prev;
          return { ...prev, [id]: { ...p, claimed_by: claimedBy } };
        });
        return { ok: true, claimedBy };
      }
      // Refused -- but the server told us the truth about who holds it, so
      // record that rather than leaving the UI showing a stale owner.
      setProjects(prev => {
        const p = prev[id];
        if (!p) return prev;
        return { ...prev, [id]: { ...p, claimed_by: claimedBy } };
      });
      return { ok: false, claimedBy, reason: body?.reason };
    } catch {
      return { ok: false, claimedBy: null, reason: "network_error" };
    }
  }, []);

  const archiveProject = useCallback(async (
    id: string,
    archived: boolean,
  ): Promise<{ ok: boolean; message?: string }> => {
    const res = await apiCall(`/api/projects/${id}`, "PATCH", { archived });
    if (res?.data) {
      const p = res.data as Project;
      setProjects(prev => ({ ...prev, [p.id]: p }));
      return { ok: true };
    }
    const err = res as { message?: string; error?: string } | null;
    return { ok: false, message: err?.message ?? err?.error ?? "Could not archive this project." };
  }, []);

  /**
   * Archive or restore one STANDALONE row.
   *
   * ⚠ A REFUSAL IS REVERTED AND REPORTED. This used to apply the change
   * locally, await the PATCH and discard the result. A refused archive --
   * somebody else's claim, or since 2026-09-16 a project-linked group --
   * wrote nothing on the server, so no realtime event came back to correct
   * it, and the row stayed gone from the board until a refresh: the SHO-1052
   * symptom, produced entirely in the browser.
   *
   * ⚠ IT REVERTS THE ONE ROW, NOT A SNAPSHOT OF THE ARRAY. A snapshot taken
   * inside a setState updater is filled in only when React gets round to
   * running the updater, so restoring one undoes other rows' changes that
   * landed meanwhile -- or, if the refusal beats the render, blanks every
   * row. moveStage and updateTeamMember did exactly that until 2026-09-16.
   * See undoFields.
   *
   * This undoes only what the call did: the flag goes back to its value
   * before the call, and the call's own activity entry is removed. Other
   * fields -- including any realtime write that landed meanwhile -- are left
   * as they are.
   *
   * ⚠ NO CLIENT COPY OF THE PROJECT RULE HERE. The server refuses and this
   * reports it; the controls ask archivesAsOrder so they never offer it. A
   * copy in the store would be a third thing to keep in step.
   */
  const setOrderArchived = useCallback(async (
    id: string,
    archived: boolean,
  ): Promise<ArchiveResult> => {
    const entry = {
      text: archived ? "Moved to archive" : "Restored from archive",
      time: today(),
      at: new Date().toISOString(),
    };
    let previous: boolean | undefined;
    setRawOrders(prev => prev.map(o => {
      if (o.id !== id) return o;
      previous = o.archived;
      return { ...o, archived, activity: [...o.activity, entry] };
    }));
    const revert = () => setRawOrders(prev => prev.map(o =>
      o.id === id && o.activity.includes(entry)
        ? { ...o, archived: previous ?? !archived, activity: o.activity.filter(a => a !== entry) }
        : o));

    let res: Response;
    try {
      res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
    } catch {
      revert();
      return { ok: false, error: "network_error" };
    }
    if (res.ok) return { ok: true };

    revert();
    let payload: { error?: string; message?: string } = {};
    try { payload = await res.json(); } catch { /* not JSON */ }
    return {
      ok: false,
      error: payload.error ?? `HTTP ${res.status}`,
      message: payload.message,
    };
  }, []);

  const archiveOrder = useCallback(
    (id: string) => setOrderArchived(id, true), [setOrderArchived]);
  const unarchiveOrder = useCallback(
    (id: string) => setOrderArchived(id, false), [setOrderArchived]);

  const updateOrderDetails = useCallback(async (id: string, details: { door_style?: string; color?: string; sku_items?: { sku: string; quantity: number; description?: string }[]; production_start_date?: string | null; production_est_finish_date?: string | null; scheduled_delivery_date?: string | null; tracking_number?: string | null }) => {
    const update = (list: Order[]) => list.map(o => o.id === id ? { ...o, ...details } : o);
    setRawOrders(prev => update(prev));
    await apiCall(`/api/orders/${id}`, "PATCH", details);
  }, []);

  // ⚠ NOT OPTIMISTIC (2026-10-26, item 8 step 3b). updateOrderDetails paints
  // first and ignores apiCall's { __error }, so a refused change stays on
  // screen until a reload (item 52). This waits for the server, applies what
  // it confirmed -- trimmed, as the route stores it -- and otherwise returns
  // the server's own sentence for the form to show.
  const updateCustomerDetails = useCallback(async (id: string, details: { name?: string; customer_email?: string; customer_phone?: string; ship_to?: string }): Promise<string | null> => {
    const res = await apiCall(`/api/orders/${id}`, "PATCH", details) as { __error?: string; __message?: string } | null;
    if (res && res.__error) return res.__message ?? res.__error;
    const stored = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    setRawOrders(prev => prev.map(o => o.id === id ? { ...o, ...stored } : o));
    return null;
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    setRawOrders(prev => prev.filter(o => o.id !== id));
    await apiCall(`/api/orders/${id}`, "DELETE");
  }, []);

  // ⚠ NOT OPTIMISTIC: the server checks the conversation with Help Scout, and
  // a purchase shown as consented that is not would be the worst kind of wrong.
  const recordConsent = useCallback(async (
    projectId: string, conversation: string, agreedAt: string,
  ): Promise<ArchiveResult> => {
    let res: Response;
    try {
      res = await fetch(`/api/projects/${projectId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation, agreed_at: agreedAt }),
      });
    } catch {
      return { ok: false, error: "network_error" };
    }
    let body: { error?: string; message?: string; data?: Project } | null = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !body?.data) return { ok: false, error: body?.error ?? `HTTP ${res.status}`, message: body?.message };
    const p = body.data;
    setProjects(prev => ({ ...prev, [p.id]: p }));
    return { ok: true };
  }, []);

  // ⚠ NOT OPTIMISTIC (2026-10-13). A close can be refused -- a denial without
  // its reason, a claim somebody else holds -- and a claim shown archived that
  // is not would be worse than a moment's wait. The row updates on success.
  const closeClaim = useCallback(async (
    id: string, outcome: "approved" | "denied", reason: string,
  ): Promise<ArchiveResult> => {
    let res: Response;
    try {
      res = await fetch(`/api/orders/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, reason }),
      });
    } catch {
      return { ok: false, error: "network_error" };
    }
    let body: { error?: string; message?: string; closed_by?: string; closed_at?: string } | null = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}`, message: body?.message };
    setRawOrders(prev => prev.map(o => o.id !== id ? o : {
      ...o, archived: true, archived_at: body?.closed_at ?? new Date().toISOString(),
      claim_outcome: outcome, closed_at: body?.closed_at ?? null, closed_by: body?.closed_by ?? null,
      closed_reason: reason || null,
    }));
    return { ok: true };
  }, []);

  const bulkAction = useCallback(async (
    ids: string[],
    action: { type: "archive"; archived: boolean } | { type: "delete" }
  ) => {
    // ⚠ `move` was removed 2026-08-24. Bulk is a CLEANUP tool: archive and
    // delete only. The route had drifted from the single-order PATCH in five
    // ways -- no delivery-proof gate, no payment hold, half an attachment
    // gate, claimed_by wiped on every forward move, entered_by written as a
    // display name rather than a team_members.id. See the header of
    // app/api/orders/bulk/route.ts.
    //
    // No optimistic update: a delete that fails per row (a non-custom id,
    // say) would otherwise vanish a row that is still there. We refresh from
    // the server after the response.
    const payload = action.type === "delete"
      ? { ids, action: "delete" }
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

    // No PIN branch: the admin PIN gated BACKWARD STAGE MOVES, and bulk no
    // longer moves stages at all. Bulk delete is gated on admin ROLE, checked
    // server-side before any row is read, and returns a plain 403.

    if (!res.ok) {
      return null;
    }

    // Always refresh from server so local state matches reality. This is
    // simpler and safer than trying to reconcile per-row optimistic updates.
    // Same fan-out as refetchAll, derived for the same reason.
    const typeRes = await Promise.all(
      ORDER_TYPES.map(t => apiCall(`/api/orders?type=${t}`)));
    setRawOrders(prev => mergeFetched(prev,
      ORDER_TYPES.map((type, i) => ({ type, res: typeRes[i] }))));

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
    setRawOrders(prev2 => optimistic(prev2));

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
      setRawOrders(prev2 => reconcile(prev2));

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
      setRawOrders(prev2 => revert(prev2));
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
    // ⚠ NO SNAPSHOT OF THE ARRAY (fixed 2026-09-16). `prevSnapshot` was taken
    // inside a setState updater, so a rejected change -- a weak password is a
    // 422 -- restored the team as it stood at the next render, undoing
    // anything else changed since, or `[]` if the rejection came back first.
    // Same defect as moveStage; see undoFields.
    let before: TeamMember | undefined;
    let after: TeamMember | undefined;
    setTeam(prev => prev.map(m => {
      if (m.id !== id) return m;
      before = m;
      after = { ...m, ...updates };
      return after;
    }));
    const res = await apiCall(`/api/team/${id}`, "PATCH", {
      name: updates.name, username: updates.username, initials: updates.initials,
      role: updates.role, avatarColor: updates.avatarColor,
      active: updates.active, password: updates.password,
    });
    // apiCall returns { __error } on failure, or the parsed body on success.
    if (res?.__error) {
      // Undo this member's optimistic change and report the real error.
      setTeam(prev => prev.map(m =>
        m.id === id && before && after ? undoFields(m, before, after) : m));
      return { ok: false, error: res.__error };
    }
    // Reconcile against the server's authoritative state.
    const teamRes = await apiCall("/api/team");
    if (teamRes?.data) setTeam(teamRes.data.map(shapeTeamMember));
    return { ok: true };
  }, []);

  const deactivateTeamMember = useCallback(async (id: string) => {
    let before: TeamMember | undefined;
    let after: TeamMember | undefined;
    setTeam(prev => prev.map(m => {
      if (m.id !== id) return m;
      before = m;
      after = { ...m, active: false };
      return after;
    }));
    const res = await apiCall(`/api/team/${id}`, "PATCH", { active: false });
    if (res?.__error) {
      setTeam(prev => prev.map(m =>
        m.id === id && before && after ? undoFields(m, before, after) : m));
      return { ok: false, error: res.__message ?? res.__error };
    }
    return { ok: true, claims: res?.claims as ClaimsOutcome | undefined };
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

  const deleteTeamMember = useCallback(async (id: string, assign?: Record<string, string>) => {
    // ⚠ THE ROW GOES BACK WHERE IT WAS. A removal cannot be undone with
    // undoFields -- there is no row left to mend -- so the member and its
    // position are kept and re-inserted if the server refuses.
    let removed: TeamMember | undefined;
    let at = -1;
    setTeam(prev => {
      at = prev.findIndex(m => m.id === id);
      removed = at >= 0 ? prev[at] : undefined;
      return prev.filter(m => m.id !== id);
    });
    const res = await apiCall(`/api/team/${id}?hard=true`, "DELETE", { assign: assign ?? {} });
    if (res?.__error) {
      setTeam(prev => {
        if (!removed || prev.some(m => m.id === id)) return prev;
        const next = [...prev];
        next.splice(at < 0 ? next.length : at, 0, removed);
        return next;
      });
      return { ok: false, error: res.__message ?? res.__error };
    }
    return { ok: true, claims: res?.claims as ClaimsOutcome | undefined };
  }, []);

  const memberOpenWork = useCallback(async (id: string) => {
    const res = await apiCall(`/api/team/${encodeURIComponent(id)}/work`);
    if (!res || res.__error) return { ok: false, error: res?.__message ?? res?.__error ?? "Could not load their work." };
    return { ok: true, work: (res.data ?? []) as MemberWorkItem[] };
  }, []);

  return (
    <Store.Provider value={{
      allOrders, allOrdersIncludingArchived: resolvedOrders,
      orders, warranties, samples, customs, hardware, projects, team, onlineUsers, loading,
      addOrder, moveStage, updateNotes, updateInternalNotes, updateOrderDetails, updateCustomerDetails, archiveProject, claimProject, archiveOrder, unarchiveOrder, deleteOrder, closeClaim, recordConsent, bulkAction,
      claimOrder, addTeamMember, updateTeamMember, deactivateTeamMember, deleteTeamMember, memberOpenWork,
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
