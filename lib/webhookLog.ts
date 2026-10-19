import { supabase } from "@/lib/supabase";

// ⚠ MOVED HERE FROM app/api/shopify/webhook/route.ts ON 2026-10-19, unchanged,
// so the hourly reconciler (app/api/cron/webhook-health) records a removal in
// the same table, the same shape, as the webhook does. `topic` tells them
// apart: a Shopify topic for the webhook, `reconcile/…` for the reconciler.

/**
 * Log a webhook outcome so an order that fails to appear is diagnosable.
 *
 * This route previously logged nothing at all, which meant "Shopify never
 * called us", "called and the insert was rejected" and "called with a bad
 * HMAC" were indistinguishable from the box -- and the Shopify admin
 * webhook page shows stale delivery data.
 *
 *   docker logs <container> | grep shopify-webhook
 *
 * METADATA ONLY. Never customer names, addresses or line detail.
 */
/**
 * Record what this delivery did.
 *
 * ⚠ TWO DESTINATIONS ON PURPOSE. The row in `webhook_events` is the durable
 * record -- console output lives in a container that is replaced on every
 * deploy, which is why the SHO-1051 deletion bug survived two attempts and
 * was nearly impossible to diagnose. The console line stays because it is
 * what you can still read during a deploy, before the container is healthy,
 * or when the database is the thing that is broken.
 *
 * ⚠ THE INSERT IS NOT AWAITED. A webhook handler must not fail or slow
 * because logging failed: Shopify retries on a non-2xx, so an error here
 * would become a redelivery loop for a webhook that already did its work.
 * This runs in a long-lived container, so the promise settles after the
 * response rather than being discarded.
 *
 * ⚠ IT FALLS BACK TO stderr IF THE WRITE FAILS. A log table that quietly
 * stops recording is the same shape as the bug this replaces -- something
 * reporting success while doing nothing.
 */
export function logWebhook(outcome: string, extra?: Record<string, unknown>) {
  console.warn("[shopify-webhook]", JSON.stringify({ outcome, ...extra }));

  // The three fields every caller means are columns; the rest is per-outcome
  // and stays in `detail` -- `blocked_by` on a refused deletion, `table` and
  // `message` on a failed one, `groups` on a success.
  const { topic, shopify_id, order_id, ...detail } = (extra ?? {}) as {
    topic?: unknown; shopify_id?: unknown; order_id?: unknown;
    [k: string]: unknown;
  };

  void supabase
    .from("webhook_events")
    .insert({
      source: "shopify",
      topic: typeof topic === "string" ? topic : null,
      outcome,
      shopify_id: shopify_id == null ? null : String(shopify_id),
      order_id: typeof order_id === "string" ? order_id : null,
      detail: Object.keys(detail).length > 0 ? detail : null,
    })
    .then(
      ({ error }) => {
        if (error) {
          console.warn("[shopify-webhook] log_insert_failed", JSON.stringify({
            outcome, message: error.message,
          }));
        }
      },
      (err: unknown) => {
        console.warn("[shopify-webhook] log_insert_threw", String(err));
      },
    );
}
