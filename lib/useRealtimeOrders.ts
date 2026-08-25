"use client";

/**
 * Subscribes to realtime INSERT/UPDATE/DELETE events on the orders table.
 *
 * Wires events into the store's setOrders / setWarranties via callback
 * passed in by the caller. The hook owns the subscription lifecycle:
 * opens on mount, closes on unmount.
 *
 * The hook is intentionally generic — it doesn't know about React state
 * or the StoreProvider. It just emits events. The caller decides what to
 * do with them. This makes the hook easy to test and easy to reuse if we
 * later split orders/warranties into separate channels.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "./realtimeClient";
import { Order, shapeOrder } from "./data";

interface RealtimeOrdersHandlers {
  /** Called when an order is INSERTed. Decide based on `type` whether
   *  it's an order or a warranty. */
  onInsert: (row: Order) => void;
  /** Called when an order is UPDATEd. The full new row is provided
   *  thanks to REPLICA IDENTITY FULL on the table. */
  onUpdate: (row: Order) => void;
  /** Called when an order is DELETEd. Only `id` is reliable; other
   *  fields may be present (REPLICA IDENTITY FULL) but treat them as
   *  best-effort. */
  onDelete: (id: string) => void;
  /** Called when the subscription connects (or reconnects). Useful for
   *  refetching to catch up on missed events during a network blip. */
  onReconnect?: () => void;
}

interface RealtimeProjectsHandlers {
  /** INSERT and UPDATE both land here -- the store keys projects by id, so
   *  there is nothing for the two cases to do differently. */
  onUpsert: (row: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}

export function useRealtimeOrders(handlers: RealtimeOrdersHandlers) {
  const { status } = useSession();
  // Stash handlers in a ref so we don't re-subscribe every render
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        const client = await getRealtimeClient();
        if (cancelled) return;

        channel = client
          .channel("orders-realtime")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "orders" },
            (payload) => {
              try {
                const shaped = shapeOrder(payload.new as Record<string, unknown>);
                handlersRef.current.onInsert(shaped);
              } catch (err) {
                console.warn("[realtime] insert handler failed", err);
              }
            },
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "orders" },
            (payload) => {
              try {
                const shaped = shapeOrder(payload.new as Record<string, unknown>);
                handlersRef.current.onUpdate(shaped);
              } catch (err) {
                console.warn("[realtime] update handler failed", err);
              }
            },
          )
          .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "orders" },
            (payload) => {
              try {
                const id = (payload.old as { id?: string })?.id;
                if (id) handlersRef.current.onDelete(id);
              } catch (err) {
                console.warn("[realtime] delete handler failed", err);
              }
            },
          )
          .subscribe((subscribeStatus) => {
            if (subscribeStatus === "SUBSCRIBED") {
              // Note: this also fires on RECONNECT after a network blip.
              // Refetching here is cheap insurance against events missed
              // during the disconnect window.
              handlersRef.current.onReconnect?.();
            }
          });
      } catch (err) {
        // Realtime is best-effort. If it can't connect, the app still
        // works — initial load is REST, mutations are REST, just no
        // live updates. Log and move on.
        console.warn("[realtime] could not establish subscription", err);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void channel.unsubscribe();
      }
    };
  }, [status]);
}

/**
 * The same subscription, for the `projects` table.
 *
 * ⚠ WHY THIS EXISTS AT ALL. `payment_status` and the four money columns live
 * on `projects`. Without this, a refund arriving from Shopify does not reach an
 * open browser until the next full refetch -- and the payment hold exists
 * precisely to stop an order moving forward after a refund. A control that
 * arrives on reload is not the control that was designed.
 *
 * Its own channel rather than more `.on()` calls on the orders channel: the two
 * tables have independent lifecycles, and one failing to subscribe should not
 * take the other down with it.
 */
export function useRealtimeProjects(handlers: RealtimeProjectsHandlers) {
  const { status } = useSession();
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);

  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        const client = await getRealtimeClient();
        if (cancelled) return;

        channel = client
          .channel("projects-realtime")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "projects" },
            (payload) => {
              try {
                if (payload.eventType === "DELETE") {
                  const id = (payload.old as { id?: string })?.id;
                  if (id) handlersRef.current.onDelete(id);
                  return;
                }
                handlersRef.current.onUpsert(payload.new as Record<string, unknown>);
              } catch (err) {
                console.warn("[realtime] project handler failed", err);
              }
            },
          )
          .subscribe();
      } catch (err) {
        // Best-effort, same as orders: initial load is REST and mutations are
        // REST, so a failed subscription costs live updates, not function.
        console.warn("[realtime] could not subscribe to projects", err);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, [status]);
}
