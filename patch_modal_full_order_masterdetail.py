#!/usr/bin/env python3
"""
patch_modal_full_order_masterdetail.py

Converts the Full Order tab from STACKED groups to MASTER-DETAIL.

Increment 3 shipped a version that stacked one OrderDetails per group, each
under a header. That reads badly at real size: a 54-line cabinet order followed
by hardware followed by samples is one long scroll with no way to see the shape
of the project.

Master-detail instead:

  A table of the orders IN the project -- Description, Vendors, Parts, Stage --
  and selecting one opens its lines. The detail is OrderDetails, unchanged: it
  already groups by vendor, door style and colour with a header per group, which
  is exactly the grouped read the cabinets need. Stage sits on the detail header
  rather than as a column, because every line in a group shares its group's
  stage and a column would repeat one value 54 times.

A project with one work group opens straight into its detail -- clicking through
a single-row table to reach the only thing in it is ceremony.

⚠ "Parts" is total QUANTITY. The tab badge counts LINES, which is the mockup's
"54 items". Two different questions, both labelled; if they should agree, the
badge is the one to change.

Idempotent. Validates the anchor before writing anything.

    cd ~/cabinet-orders
    python3 patch_modal_full_order_masterdetail.py
    npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"   # EXIT:1 = clean
"""

import sys
from pathlib import Path

TARGET = "components/OrderModal.tsx"

OLD_PANE = '          {tab === "items" && (\n            <div className="flex flex-col">\n              {projectGroups\n                .filter((g) => g.type !== "warranty")\n                .map((g) => (\n                  <div key={g.id}>\n                    {/* Section header per group. Renders even for a project of\n                        one so the stage is always stated -- a table of lines\n                        with no indication of where those lines have got to is\n                        the thing this tab exists to fix. */}\n                    <div\n                      className="flex items-center gap-2 px-6 pt-5 pb-1"\n                    >\n                      <span\n                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"\n                        style={{ background: STAGE_ACCENT[g.stage] ?? "#8a8a8a" }}\n                      />\n                      <span className="text-[10px] uppercase tracking-wider font-medium text-cream/85">\n                        {GROUP_LABEL[g.type] ?? g.type}\n                      </span>\n                      <span className="text-[10px] text-cream/40">·</span>\n                      <span\n                        className="text-[10px] uppercase tracking-wider"\n                        style={{ color: STAGE_ACCENT[g.stage] ?? "#8a8a8a" }}\n                      >\n                        {g.stage}\n                      </span>\n                      <span className="text-[10px] text-cream/30 font-mono ml-auto">{g.id}</span>\n                    </div>\n                    <OrderDetails\n                      orderId={g.id}\n                      doorStyle={g.door_style ?? ""}\n                      color={g.color ?? ""}\n                      skuItems={g.sku_items ?? []}\n                      productionStartDate={g.production_start_date}\n                      productionEstFinishDate={g.production_est_finish_date}\n                      scheduledDeliveryDate={g.scheduled_delivery_date}\n                      readOnly={g.source === "Shopify"}\n                    />\n                  </div>\n                ))}\n              {projectGroups.every((g) => g.type === "warranty") && (\n                <div className="px-6 py-8 text-center">\n                  <p className="text-[12px] text-cream/45">\n                    A warranty claim carries damage reports, not SKU lines.\n                  </p>\n                </div>\n              )}\n            </div>\n          )}\n\n'

NEW_PANE = '          {tab === "items" && (() => {\n            const workGroups = projectGroups.filter((g) => g.type !== "warranty");\n            if (workGroups.length === 0) {\n              return (\n                <div className="px-6 py-8 text-center">\n                  <p className="text-[12px] text-cream/45">\n                    A warranty claim carries damage reports, not SKU lines.\n                  </p>\n                </div>\n              );\n            }\n            // A project of one IS its own detail. Making somebody click a\n            // single-row table to reach the only thing in it is ceremony.\n            const openId = workGroups.length === 1 ? workGroups[0].id : itemsGroupId;\n            const open = openId ? workGroups.find((g) => g.id === openId) : undefined;\n\n            if (open) {\n              return (\n                <div className="flex flex-col">\n                  <div className="flex items-center gap-2 px-6 pt-5 pb-1">\n                    {workGroups.length > 1 && (\n                      <button\n                        onClick={() => setItemsGroupId(null)}\n                        className="text-[10px] uppercase tracking-wider text-cream/45 hover:text-cream/85 transition-colors mr-1"\n                      >\n                        &larr; All\n                      </button>\n                    )}\n                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"\n                      style={{ background: STAGE_ACCENT[open.stage] ?? "#8a8a8a" }} />\n                    <span className="text-[10px] uppercase tracking-wider font-medium text-cream/85">\n                      {GROUP_LABEL[open.type] ?? open.type}\n                    </span>\n                    <span className="text-[10px] text-cream/40">&middot;</span>\n                    {/* Stage lives on the HEADER, not as a column repeated down\n                        every row. Every line in a group shares its group stage,\n                        so a column would be the same value 54 times. */}\n                    <span className="text-[10px] uppercase tracking-wider"\n                      style={{ color: STAGE_ACCENT[open.stage] ?? "#8a8a8a" }}>\n                      {open.stage}\n                    </span>\n                    <span className="text-[10px] text-cream/30 font-mono ml-auto">{open.id}</span>\n                  </div>\n                  {/* OrderDetails already groups by vendor, door style and colour\n                      with a header per group -- reused, not reimplemented. It is\n                      571 lines and it EDITS: adds and removes lines, saves them\n                      back, resolves vendors, renders review flags. */}\n                  <OrderDetails\n                    orderId={open.id}\n                    doorStyle={open.door_style ?? ""}\n                    color={open.color ?? ""}\n                    skuItems={open.sku_items ?? []}\n                    productionStartDate={open.production_start_date}\n                    productionEstFinishDate={open.production_est_finish_date}\n                    scheduledDeliveryDate={open.scheduled_delivery_date}\n                    readOnly={open.source === "Shopify"}\n                  />\n                </div>\n              );\n            }\n\n            return (\n              <div className="px-6 py-5">\n                <div className="rounded-brand overflow-hidden" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>\n                  <div className="grid grid-cols-[1.4fr_1.6fr_auto_auto] gap-3 px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40"\n                    style={{ background: "rgba(255,255,255,0.03)" }}>\n                    <span>Description</span>\n                    <span>Vendors</span>\n                    <span className="text-right">Parts</span>\n                    <span className="text-right">Stage</span>\n                  </div>\n                  {workGroups.map((g) => {\n                    const items = g.sku_items ?? [];\n                    const vendors = Array.from(new Set(\n                      items.map((i) => String(i.vendor ?? "").trim()).filter(Boolean)));\n                    // Total QUANTITY -- "parts" is the number of physical things.\n                    // The tab badge counts LINES, the mockup\\\'s "54 items".\n                    // Different questions, both labelled.\n                    const parts = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);\n                    const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";\n                    return (\n                      <button key={g.id} onClick={() => setItemsGroupId(g.id)}\n                        className="w-full grid grid-cols-[1.4fr_1.6fr_auto_auto] gap-3 px-4 py-3 text-left transition-colors hover:bg-white/4"\n                        style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>\n                        <span className="text-[12px] text-cream/85">{GROUP_LABEL[g.type] ?? g.type}</span>\n                        <span className="text-[11px] text-cream/55 truncate">\n                          {vendors.length > 0 ? vendors.join(", ") : (g.vendor || "\\u2014")}\n                        </span>\n                        <span className="text-[11px] text-cream/70 text-right tabular-nums">{parts || "\\u2014"}</span>\n                        <span className="text-[10px] uppercase tracking-wider text-right whitespace-nowrap"\n                          style={{ color: accent }}>{g.stage}</span>\n                      </button>\n                    );\n                  })}\n                </div>\n              </div>\n            );\n          })()}\n\n'

STEPS = [
    (
        "drill-in state",
        "  const itemCount = useMemo(",
        "const [itemsGroupId",
        "  // Which group's lines are open on Full Order. null = the summary table.\n"
        "  // Reset with the tab so reopening the modal never lands mid-drill.\n"
        "  const [itemsGroupId, setItemsGroupId] = useState<string | null>(null);\n"
        "  const itemCount = useMemo(",
    ),
    (
        "reset on reopen",
        'setTab("project"); }, [order.id]);',
        "setItemsGroupId(null); }, [order.id]);",
        'setTab("project"); setItemsGroupId(null); }, [order.id]);',
    ),
    (
        "master-detail pane",
        OLD_PANE,
        "const workGroups = projectGroups.filter",
        NEW_PANE,
    ),
]


def main() -> int:
    path = Path.cwd() / TARGET
    if not path.is_file():
        print(f"ABORT: {TARGET} not found. Run from ~/cabinet-orders.")
        return 1
    text = path.read_text(encoding="utf-8")
    original = text

    def satisfied(marker, t):
        return (marker[1:] not in t) if marker.startswith("!") else (marker in t)

    planned, skipped, problems = [], [], []
    for label, anchor, marker, replacement in STEPS:
        if satisfied(marker, text):
            skipped.append(label); continue
        if anchor == replacement:
            problems.append(f"{label} -- replacement is identical to the anchor"); continue
        n = text.count(anchor)
        if n != 1:
            problems.append(f"{label} -- anchor matches {n} time(s), expected 1")
        else:
            planned.append((label, anchor, marker, replacement))

    if problems:
        print("ABORT -- nothing written:")
        for p in problems: print("  " + p)
        return 1
    if not planned:
        print("Already applied in full. Nothing to do.")
        for s in skipped: print("  skip " + s)
        return 0

    for label, anchor, marker, replacement in planned:
        text = text.replace(anchor, replacement, 1)
    for label, anchor, marker, replacement in planned:
        if not satisfied(marker, text):
            print(f"ABORT -- nothing written: {label} did not take effect")
            return 1

    if text.count("{") != text.count("}") or text.count("(") != text.count(")"):
        print("ABORT -- nothing written: delimiters unbalanced after patch")
        return 1

    # Verify what the patch DID. Still exactly one OrderDetails mount -- two
    # would mean two editors writing the same row. And the attachments panel
    # must still sit inside the default pane, or the needs-attachment flow
    # opens a picker on an unmounted component.
    if text.count("<OrderDetails") != 1:
        print(f"ABORT -- nothing written: {text.count('<OrderDetails')} OrderDetails mounts, expected 1")
        return 1
    p_at = text.index('{tab === "project" && (<>')
    a_at = text.index("<AttachmentsPanel ref={attachmentsRef}")
    i_at = text.index('{tab === "items" && (')
    if not (p_at < a_at < i_at):
        print("ABORT -- nothing written: attachments panel left the Project pane")
        return 1

    path.write_text(text, encoding="utf-8")
    for s in skipped: print("  skip " + s)
    for label, *_ in planned: print(f"  ok   {label}")
    print(f"\n{TARGET}: {len(original.splitlines())} -> {len(text.splitlines())} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
