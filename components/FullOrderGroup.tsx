"use client";

import type { Order, TeamMember } from "@/lib/data";
import { useAckStatus } from "@/lib/ackStatus";
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
export function FullOrderGroup({ group, team, readOnly }: { group: Order; team: TeamMember[]; readOnly: boolean }) {
  const status = useAckStatus(group.id, group.type === "order");
  const ack = status.loading ? null : ackIssues(status.ackByVendor);
  return (
    <div className="px-6 pt-3">
      <OrderHeaderCards order={group} team={team} ack={ack} />
      <OrderDetails
        orderId={group.id}
        doorStyle={group.door_style ?? ""}
        color={group.color ?? ""}
        skuItems={group.sku_items ?? []}
        productionStartDate={group.production_start_date}
        productionEstFinishDate={group.production_est_finish_date}
        scheduledDeliveryDate={group.scheduled_delivery_date}
        readOnly={readOnly}
        ack={ack ?? undefined}
      />
    </div>
  );
}
