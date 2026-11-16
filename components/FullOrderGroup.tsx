"use client";

import type { Order, TeamMember } from "@/lib/data";
import { useAckStatus } from "@/lib/ackStatus";
import { useStore } from "@/lib/store";
import { ackIssues } from "@/lib/orderIssues";
import { OrderDetails } from "./OrderDetails";
import { OrderHeaderCards } from "./OrderHeaderCards";

/**
 * One group on the Full Order tab (2026-10-07): the order's details, as the
 * vendor PDF heads them, then its lines -- each acknowledgment discrepancy told
 * on its own line. A component of its own because the acknowledgment comes
 * from a hook (useAckStatus, the shared cache the Overview reads), and the tab
 * renders from an inline function, where a hook cannot run.
 *
 * Only cabinet groups have acknowledgments; for any other the hook stays off
 * and the lines show without notes.
 */
/**
 * A group's problems, as a tag beside it on the Full Order summary (Garrett,
 * 2026-10-07): visible before the group is opened. Acknowledgment
 * discrepancies first; else lines flagged for review at ingest. Nothing when
 * the group is clean.
 */
export function GroupIssueTag({ group }: { group: Order }) {
  const status = useAckStatus(group.id, group.type === "order");
  const issues = status.loading ? null : ackIssues(status.ackByVendor, group);
  const review = (group.sku_items ?? []).filter((i) => i.needs_review).length;
  const text = issues && issues.count > 0
    ? `${issues.count} discrepanc${issues.count === 1 ? "y" : "ies"}`
    : review > 0 ? `${review} to review` : "";
  if (!text) return null;
  return (
    <span className="inline-flex items-center px-2 py-px rounded-full text-[9px] uppercase tracking-wider font-medium"
      style={{ color: "#e89090", background: "rgba(201,112,112,0.12)", border: "0.5px solid rgba(201,112,112,0.45)" }}>
      {text}
    </span>
  );
}

/**
 * Two answers (item 9, 2026-11-10): `readOnly` for the lines -- a Shopify
 * group's, archived work's, a colleague's claim's -- and `backorderReadOnly` for
 * the backorder pill, which staff set on a Shopify group too.
 */
export function FullOrderGroup({ group, team, readOnly, backorderReadOnly }: {
  group: Order; team: TeamMember[]; readOnly: boolean; backorderReadOnly: boolean;
}) {
  const status = useAckStatus(group.id, group.type === "order");
  const ack = status.loading ? null : ackIssues(status.ackByVendor, group);
  const { projects } = useStore();
  return (
    <div className="px-6 pt-3">
      <OrderHeaderCards order={group} team={team} ack={ack} project={group.project_id ? projects[group.project_id] ?? null : null} />
      <OrderDetails
        orderId={group.id}
        doorStyle={group.door_style ?? ""}
        color={group.color ?? ""}
        skuItems={group.sku_items ?? []}
        productionStartDate={group.production_start_date}
        productionEstFinishDate={group.production_est_finish_date}
        scheduledDeliveryDate={group.scheduled_delivery_date}
        readOnly={readOnly}
        backorderReadOnly={backorderReadOnly}
        ack={ack ?? undefined}
      />
    </div>
  );
}
