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
import { Order } from "./data";

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

// We pass raw rows through this same shaper as the initial REST load.
// Keeping the shape consistent everywhere means store reducers only see
// one canonical Order shape regardless of source.
function shapeOrderRow(raw: Record<string, unknown>): Order {
  return {
    id: raw.id as string,
    type: (raw.type as "order" | "warranty") ?? "order",
    name: raw.name as string,
    source: (raw.source as Order["source"]) ?? "Manual",
    detail: (raw.detail as string) ?? "",
    stage: (raw.stage as Order["stage"]) ?? "New",
    member: (raw.member as Order["member"]) ?? "AX",
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
                const shaped = shapeOrderRow(payload.new as Record<string, unknown>);
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
                const shaped = shapeOrderRow(payload.new as Record<string, unknown>);
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
