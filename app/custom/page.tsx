import { AppShell } from "@/components/AppShell";
import { OrdersHubClient } from "@/components/OrdersHubClient";

export const metadata = { title: "Custom Orders \u2014 JK Cabinets" };

/**
 * ⚠ ONE COMPONENT FOR EVERY LIST PAGE.
 *
 * This had its own client until 2026-08-26 -- as did the other list pages --
 * and all of them were the same component: pick rows of one type, filter by
 * stage, search, render OrderTable. The gates were never in them; they live in
 * OrderTable's action column, in PATCH /api/orders/[id] and in the flow maps.
 *
 * Being three copies meant the same bug three times: each passed a "__none__"
 * sentinel as OrderTable's `stage` on its All tab, which no branch matched, so
 * the Status column rendered the sentinel verbatim on every row.
 */
export default function Page() {
  return (
    <AppShell>
      <OrdersHubClient type="custom" createLabel="New custom job" />
    </AppShell>
  );
}
