#!/usr/bin/env python3
"""
JK Cabinets OMS — one shapeOrder, not two, and it maps every field.

  lib/data.ts              shapeOrder moves here, beside the Order type
  lib/store.tsx            imports it instead of defining it
  lib/useRealtimeOrders.ts shapeOrderRow deleted; uses the real one

THE BUG
    lib/useRealtimeOrders.ts carried its own shapeOrderRow -- a copy of
    shapeOrder that stopped being updated. It differs in three ways:

      type: (raw.type as "order" | "warranty") ?? "order"   <- TWO types
      (no created_at)
      (no reported_at)

    So every row arriving over REALTIME was shaped by the pre-Alternate-Orders
    version. A sample or custom order inserted by another tab was cast to a
    two-value union, and created_at / reported_at were dropped -- which the SLA
    rules read, since New measures from the order date and warranty New claim
    from reported_at. The row silently carried defaults until the next full
    fetch corrected it.

    Phase 1b collapsed the store to ONE array precisely so type routing could
    not drift. This copy sat outside that change and kept the old shape.

WHY THIS KEEPS HAPPENING
    It is the same failure as mergeTags, the four definitions of "overdue" and
    the seven stage-colour maps: a copy that agrees with the original until one
    of them is edited. The fix is always the same -- delete the copy.

WHERE IT LIVES NOW
    lib/data.ts, next to the Order interface it builds. Not store.tsx: shaping
    a database row has nothing to do with React state, and useRealtimeOrders
    should not import from the store it feeds.

ALSO FIXED: THREE DELIVERY FIELDS THAT WERE NEVER MAPPED
    Order declares delivery_date, scheduled_delivery_date, delivery_window and
    delivery_notes. shapeOrder mapped ONE of them. The other three were
    undefined on every row, on every load path.

    The consequences, one latent and one live:

      · The At-cross-dock SLA rule is
        `clockRuns: o => !o.delivery_date && !o.scheduled_delivery_date`.
        With delivery_date permanently undefined that reduces to the second
        test alone, so an order with a real delivery_date but no scheduled one
        would keep its clock running and flag overdue while the awaited data
        actually exists. Latent only because delivery_date is currently null on
        every row -- it would bite the first time one is set.

      · delivery_window and delivery_notes DO carry data (12 rows). Every store
        consumer saw undefined. This has not been visible because
        app/calendar/page.tsx fetches orders itself with its own interface, so
        the calendar reads the real values while the store does not -- a second
        implementation masking a gap in the shared one, which is the same
        pattern as the realtime copy this patch removes.

CONTRACT
  - Moves the function VERBATIM; the only additions are doc comments.
  - Anchors validated across three files; nothing written on a miss.
  - Verifies exactly one shapeOrder definition remains.
  - Idempotent.

RUN ON THE BOX:
  cd ~/cabinet-orders && python3 patch_one_shape_order.py
"""

import os
import sys

ROOT = os.path.expanduser("~/cabinet-orders")
DATA = os.path.join(ROOT, "lib/data.ts")
STORE = os.path.join(ROOT, "lib/store.tsx")
RT = os.path.join(ROOT, "lib/useRealtimeOrders.ts")

STEPS = []


def step(path, label, old, new, marker):
    STEPS.append((path, label, old, new, marker))


# The function exactly as it exists in store.tsx today.
SHAPE_BODY = '''function shapeOrder(raw: Record<string, unknown>): Order {
  return {
    id: raw.id as string,
    type: (raw.type as OrderType) ?? "order",
    name: raw.name as string,
    source: (raw.source as Source) ?? "Manual",
    detail: (raw.detail as string) ?? "",
    stage: (raw.stage as Stage) ?? "New",
    member: (raw.member as Member) ?? "AX",
    date: (raw.date as string) ?? "",
    // /api/orders selects `*`, so this has always been on the wire -- it
    // just was not mapped through. The SLA rules for New need it.
    created_at: (raw.created_at as string | null) ?? null,
    // Set on promotion from claim_submissions.received_at. Null on every
    // other flow, and on every row until the intake work lands -- the SLA
    // rules fall back to created_at when it is absent.
    reported_at: (raw.reported_at as string | null) ?? null,
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
    delivery_date: (raw.delivery_date as string | null) ?? null,
    delivery_window: (raw.delivery_window as string) ?? "",
    delivery_notes: (raw.delivery_notes as string) ?? "",
  };
}
'''

DOC = '''/**
 * Shape a raw `orders` row into the canonical Order.
 *
 * THE ONLY implementation. It lives here, beside the Order interface it
 * builds, because BOTH paths into the store need it: the REST load in
 * store.tsx and the realtime events in useRealtimeOrders.
 *
 * useRealtimeOrders used to carry its own copy, which stopped being updated --
 * it cast `type` to "order" | "warranty" long after there were four types, and
 * never learned created_at or reported_at. Every row arriving over realtime
 * was shaped by that stale version until the next full fetch corrected it.
 *
 * If you add a column to Order, add it HERE and nowhere else.
 */
'''

# The removal anchor must be the function EXACTLY as store.tsx has it today --
# i.e. WITHOUT the three delivery fields this patch adds. Deriving it from
# SHAPE_BODY keeps the two in step: edit the mapping once, above.
SHAPE_BODY_ORIGINAL = (
    SHAPE_BODY
    .replace('    delivery_date: (raw.delivery_date as string | null) ?? null,\n', "")
    .replace('    delivery_window: (raw.delivery_window as string) ?? "",\n', "")
    .replace('    delivery_notes: (raw.delivery_notes as string) ?? "",\n', "")
)

# =========================================================================
# 1. data.ts gains the function
# =========================================================================
step(
    DATA,
    "1  data: house shapeOrder",
    "  reported_at?: string | null;\n"
    "}\n"
    "\n"
    "export const ORDER_STAGES: OrderStage[] = [\n",
    "  reported_at?: string | null;\n"
    "}\n"
    "\n"
    + DOC + SHAPE_BODY.replace("function shapeOrder", "export function shapeOrder")
    + "\n"
    "export const ORDER_STAGES: OrderStage[] = [\n",
    "export function shapeOrder(raw: Record<string, unknown>): Order {",
)

# =========================================================================
# 2. store.tsx drops its copy and imports instead
# =========================================================================
step(
    STORE,
    "2  store: import it      ",
    "import {\n"
    "  Order, OrderType, Stage, TeamMember,\n"
    "  Member, Source, ORDER_STAGES, WARRANTY_STAGES, AvatarColor, Role,\n"
    "  ID_PREFIX_BY_TYPE,\n"
    '} from "./data";\n',
    "import {\n"
    "  Order, OrderType, Stage, TeamMember,\n"
    "  Member, Source, ORDER_STAGES, WARRANTY_STAGES, AvatarColor, Role,\n"
    "  ID_PREFIX_BY_TYPE, shapeOrder,\n"
    '} from "./data";\n',
    "ID_PREFIX_BY_TYPE, shapeOrder,",
)

step(
    STORE,
    "3  store: drop the copy  ",
    SHAPE_BODY_ORIGINAL,
    "",
    None,  # handled by the count check below
)

# =========================================================================
# 3. useRealtimeOrders uses the real one
# =========================================================================
step(
    RT,
    "4  realtime: import it   ",
    'import { Order } from "./data";\n',
    'import { Order, shapeOrder } from "./data";\n',
    'import { Order, shapeOrder } from "./data";',
)

step(
    RT,
    "5  realtime: drop copy   ",
    "// We pass raw rows through this same shaper as the initial REST load.\n"
    "// Keeping the shape consistent everywhere means store reducers only see\n"
    "// one canonical Order shape regardless of source.\n"
    "function shapeOrderRow(raw: Record<string, unknown>): Order {\n",
    "// NOTE: this file used to define its own shapeOrderRow -- a copy of\n"
    "// shapeOrder that stopped being updated and cast `type` to two values long\n"
    "// after there were four. It now uses the real one from lib/data.ts, which\n"
    "// is the only implementation. Do not reintroduce a local copy.\n"
    "function __REMOVED_shapeOrderRow(raw: Record<string, unknown>): Order {\n",
    # No marker: the sentinel below is stripped before the file is written, so
    # it can never signal "already applied". Absence of the anchor is enough.
    None,
)

for i, label in enumerate(["6  realtime: insert call ", "7  realtime: update call "], start=1):
    step(
        RT,
        label,
        "                const shaped = shapeOrderRow(payload.new as Record<string, unknown>);\n",
        "                const shaped = shapeOrder(payload.new as Record<string, unknown>);\n",
        None,
    )


def main():
    texts = {}
    for path in (DATA, STORE, RT):
        if not os.path.isfile(path):
            print("FAIL  file not found: {}".format(path))
            sys.exit(1)
        with open(path, "r", encoding="utf-8") as fh:
            texts[path] = fh.read()

    if "shapeOrderRow" in texts[RT]:
        print("ok    deps                    both copies located")
    else:
        print("ok    deps                    realtime copy already removed")

    failed = False
    applied = 0

    for path, label, old, new, marker in STEPS:
        text = texts[path]
        if marker and marker in text:
            print("ok    {}  already applied".format(label))
            continue
        n = text.count(old)
        if n == 0:
            if marker is None:
                print("ok    {}  nothing to do".format(label))
                continue
            print("FAIL  {}  ANCHOR NOT FOUND in {}".format(label, os.path.basename(path)))
            failed = True
        elif n != 1 and label.startswith(("6", "7")):
            # The two call sites are identical; replace them one at a time.
            print("ok    {}  will patch (1 of {})".format(label, n))
            texts[path] = text.replace(old, new, 1)
            applied += 1
        elif n != 1:
            print("FAIL  {}  matched {} times, expected 1".format(label, n))
            failed = True
        else:
            print("ok    {}  will patch".format(label))
            texts[path] = text.replace(old, new, 1)
            applied += 1

    if failed:
        print("\nABORTED - nothing written.")
        sys.exit(1)
    if applied == 0:
        print("\nNothing to do - all changes already present.")
        sys.exit(0)

    # Strip the disabled copy entirely.
    r = texts[RT]
    start = r.find("function __REMOVED_shapeOrderRow")
    if start != -1:
        end = r.find("\n}\n", start)
        if end == -1:
            print("\nFAIL  could not find the end of the old copy")
            print("ABORTED - nothing written.")
            sys.exit(1)
        # Also drop the explanatory comment block immediately above it.
        cstart = r.rfind("// NOTE: this file used to define", 0, start)
        texts[RT] = r[:cstart] + r[end + 3:]
        r = texts[RT]

    # Exactly ONE definition, and no lingering references to the copy.
    if texts[DATA].count("export function shapeOrder") != 1:
        print("\nFAIL  expected exactly one shapeOrder definition in data.ts")
        sys.exit(1)
    if "function shapeOrder" in texts[STORE]:
        print("\nFAIL  store.tsx still defines shapeOrder")
        sys.exit(1)
    if "shapeOrderRow" in r:
        print("\nFAIL  useRealtimeOrders still references shapeOrderRow")
        sys.exit(1)
    if r.count("shapeOrder(payload.new") != 2:
        print("\nFAIL  expected 2 shaped realtime handlers, found {}".format(
            r.count("shapeOrder(payload.new")))
        sys.exit(1)
    # The stale two-value cast must be gone from the codebase.
    if '"order" | "warranty") ?? "order"' in r:
        print("\nFAIL  the two-value type cast is still present")
        sys.exit(1)
    for field in ("delivery_date:", "delivery_window:", "delivery_notes:"):
        if field not in texts[DATA]:
            print("\nFAIL  {} was not added to shapeOrder".format(field))
            sys.exit(1)
    print("ok    verify                  one definition; realtime uses it; stale cast gone")
    print("ok    verify                  all four delivery fields mapped")

    for path, text in texts.items():
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("wrote {}".format(os.path.relpath(path, ROOT)))

    print("\nDone. Next: tsc gate, then commit + deploy.")
    sys.exit(0)


if __name__ == "__main__":
    main()
