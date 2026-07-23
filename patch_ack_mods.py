#!/usr/bin/env python3
"""Ack reconciliation Stage B — verify MODIFICATIONS against the acknowledgment.

Waypoint states modifications in prose under the cabinet rather than as their
own line items:
    DEPTH   / "REDUCED DEPTH - 13 inches"   -> RD-13
    TOEKICK / "BOTH RECESSED TK"            -> RTKB
Nothing read them, and the route flattened order lines to sku+quantity (dropping
`modifications`), so a cabinet acknowledged at the wrong depth or with the wrong
toe kick reconciled as a clean match. Verified against a real edited ack:
depth 13->12 and BOTH->LEFT now raise a mod_mismatch.

  1. lib/waypointAck.ts  — read the attribute rows under each line into
     `modifications` (codes) + `attributes` (verbatim record).
  2. app/api/orders/[id]/acknowledgment/route.ts — carry the order line's
     modification codes into the reconciler.
  3. lib/reconcile.ts    — compare mods per composite SKU; new "mod_mismatch"
     status (flows into lines_ok / verdict / discrepancy count automatically).
  4. components/AcknowledgmentPanel.tsx — render the new status naming both sides.

REQUIRES Stage A (patch_ack_sku_match.py) to be applied first.
Validates ALL anchors before writing ANY. Idempotent.
"""
import sys, io

JOBS = [
    # ── 1. lib/waypointAck.ts ───────────────────────────────────────────────
    (
        "lib/waypointAck.ts",
        "interpretAttribute",
        [
            (
                "AckLineItem gains modifications + attributes",
                "export interface AckLineItem {\n"
                "  base_sku: string;\n"
                "  door_code: string;\n"
                "  color_name: string;\n"
                "  color_code: string;\n"
                "  composite_sku: string;\n"
                "  qty: number;\n"
                "  list_price: number | null;\n"
                "}\n",
                "export interface AckAttribute {\n"
                "  label: string;\n"
                "  value: string;\n"
                "}\n"
                "\n"
                "export interface AckLineItem {\n"
                "  base_sku: string;\n"
                "  door_code: string;\n"
                "  color_name: string;\n"
                "  color_code: string;\n"
                "  composite_sku: string;\n"
                "  qty: number;\n"
                "  list_price: number | null;\n"
                "  /** Modification sub-SKU codes read off the attribute rows (e.g. RD-13, RTKB). */\n"
                "  modifications: string[];\n"
                "  /** Every attribute row under this line, verbatim — kept for the stored record. */\n"
                "  attributes: AckAttribute[];\n"
                "}\n",
            ),
            (
                "interpretAttribute helper",
                "export function parseWaypointAck(",
                'type AttrResult =\n'
                '  | { kind: "mod"; code: string }\n'
                '  | { kind: "unreadable" }\n'
                '  | { kind: "ignore" };\n'
                "\n"
                "/**\n"
                " * Interpret one attribute row sitting under a line item.\n"
                " *\n"
                " * Waypoint states modifications in prose beneath the cabinet rather than as\n"
                " * their own line items:\n"
                ' *   DEPTH   / "REDUCED DEPTH - 13 inches"   -> RD-13\n'
                ' *   TOEKICK / "BOTH RECESSED TK"            -> RTKB\n'
                " * Mapping them onto our modification sub-SKU codes is what lets the reconciler\n"
                " * verify them against the order. Attributes that carry no modification (BOX\n"
                " * CONSTRUCTION, or a standard depth/toe kick) are recorded but ignored.\n"
                " *\n"
                " * An attribute that clearly DOES carry a modification but cannot be read is\n"
                ' * reported as "unreadable" rather than skipped — silently passing a depth we\n'
                " * could not parse is precisely the failure this gate exists to prevent.\n"
                " */\n"
                "function interpretAttribute(label: string, value: string): AttrResult {\n"
                '  const L = label.trim().toUpperCase().replace(/\\s+/g, "");\n'
                "  const V = value.trim().toUpperCase();\n"
                "\n"
                '  if (L === "DEPTH") {\n'
                "    const reduced = /REDUC/.test(V);\n"
                "    const increased = /INCREAS/.test(V);\n"
                '    if (!reduced && !increased) return { kind: "ignore" }; // e.g. a standard depth\n'
                '    const num = V.match(/(\\d+(?:\\.\\d+)?)/)?.[1] ?? "";\n'
                '    if (!num) return { kind: "unreadable" };\n'
                '    return { kind: "mod", code: `${reduced ? "RD" : "ID"}-${num}` };\n'
                "  }\n"
                "\n"
                '  if (L === "TOEKICK") {\n'
                '    if (!/RECESS/.test(V)) return { kind: "ignore" }; // e.g. a standard toe kick\n'
                '    if (/\\bBOTH\\b/.test(V)) return { kind: "mod", code: "RTKB" };\n'
                '    if (/\\bLEFT\\b/.test(V)) return { kind: "mod", code: "RTKL" };\n'
                '    if (/\\bRIGHT\\b/.test(V)) return { kind: "mod", code: "RTKR" };\n'
                '    return { kind: "unreadable" }; // recessed, but we cannot tell which side\n'
                "  }\n"
                "\n"
                '  return { kind: "ignore" };\n'
                "}\n"
                "\n"
                "export function parseWaypointAck(",
            ),
            (
                "attribute-row branch in the scan loop",
                '        // else: room label ("Kitchen"/"Master Bath") — ignore\n'
                "        continue;\n"
                "      }\n",
                '        // else: room label ("Kitchen"/"Master Bath") — ignore\n'
                "        continue;\n"
                "      }\n"
                "\n"
                "      // Attribute row: no col-A label, no qty, but a label/value pair in C/D.\n"
                "      // These describe the PRECEDING line item. Modification-bearing ones\n"
                "      // become sub-SKU codes; an unreadable one is kept verbatim so it surfaces\n"
                "      // as a discrepancy instead of vanishing.\n"
                "      if (!a && qty === null && desc) {\n"
                "        const value = cell(r, 3);\n"
                "        const last = items[items.length - 1];\n"
                "        if (last && value) {\n"
                "          last.attributes.push({ label: desc, value });\n"
                "          const res = interpretAttribute(desc, value);\n"
                '          if (res.kind === "mod") last.modifications.push(res.code);\n'
                '          else if (res.kind === "unreadable") last.modifications.push(`${desc}: ${value}`);\n'
                "        }\n"
                "        continue;\n"
                "      }\n",
            ),
            (
                "initialize the new fields on push",
                "          qty,\n"
                "          list_price: price,\n"
                "        });\n",
                "          qty,\n"
                "          list_price: price,\n"
                "          modifications: [],\n"
                "          attributes: [],\n"
                "        });\n",
            ),
        ],
    ),
    # ── 2. the upload route ─────────────────────────────────────────────────
    (
        "app/api/orders/[id]/acknowledgment/route.ts",
        "modifications: (it.modifications",
        [
            (
                "carry order-line modifications into the reconciler",
                "    sku_items: waypointLines.map((it) => ({\n"
                "      sku: it.sku,\n"
                "      quantity: Number(it.quantity) || 0,\n"
                "    })),\n",
                "    sku_items: waypointLines.map((it) => ({\n"
                "      sku: it.sku,\n"
                "      quantity: Number(it.quantity) || 0,\n"
                "      // Carry the line's modification sub-SKUs through; without them the mod\n"
                "      // gate has nothing on the order side to compare against.\n"
                "      modifications: (it.modifications ?? []).map((m) => m.sku),\n"
                "    })),\n",
            ),
        ],
    ),
    # ── 3. lib/reconcile.ts ─────────────────────────────────────────────────
    (
        "lib/reconcile.ts",
        "mod_mismatch",
        [
            (
                "AckLineItem.modifications",
                "export interface AckLineItem {\n"
                "  composite_sku: string;\n"
                "  qty: number;\n"
                "  list_price?: number | null;\n"
                "}\n",
                "export interface AckLineItem {\n"
                "  composite_sku: string;\n"
                "  qty: number;\n"
                "  list_price?: number | null;\n"
                "  /** Modification sub-SKU codes read off the ack's attribute rows (RD-13, RTKB). */\n"
                "  modifications?: string[];\n"
                "}\n",
            ),
            (
                "OrderLineItem.modifications",
                "export interface OrderLineItem {\n"
                "  sku: string;\n"
                "  quantity: number;\n"
                "}\n",
                "export interface OrderLineItem {\n"
                "  sku: string;\n"
                "  quantity: number;\n"
                "  /** Modification sub-SKU codes stored on the order line (RD-13, RTKB). */\n"
                "  modifications?: string[];\n"
                "}\n",
            ),
            (
                "LineStatus += mod_mismatch",
                'export type LineStatus = "match" | "qty_mismatch" | "missing_from_ack" | "extra_in_ack";\n',
                'export type LineStatus = "match" | "qty_mismatch" | "mod_mismatch" | "missing_from_ack" | "extra_in_ack";\n',
            ),
            (
                "LineResult carries both mod sets",
                "export interface LineResult {\n"
                "  composite_sku: string;\n"
                "  status: LineStatus;\n"
                "  order_qty: number | null;\n"
                "  ack_qty: number | null;\n"
                "}\n",
                "export interface LineResult {\n"
                "  composite_sku: string;\n"
                "  status: LineStatus;\n"
                "  order_qty: number | null;\n"
                "  ack_qty: number | null;\n"
                "  /** Modifications on each side — populated so the UI can name the difference. */\n"
                "  order_mods?: string[];\n"
                "  ack_mods?: string[];\n"
                "}\n",
            ),
            (
                "mod accumulator maps",
                "  const displayBySku = new Map<string, string>();\n"
                "  const orderBySku = new Map<string, number>();\n",
                "  const displayBySku = new Map<string, string>();\n"
                "  // Modifications are compared per composite SKU as a multiset. That cannot say\n"
                "  // WHICH duplicate line differs when a SKU repeats, but it flags any\n"
                "  // difference — a cabinet built to the wrong depth is the thing to catch.\n"
                "  const orderModsBySku = new Map<string, string[]>();\n"
                "  const ackModsBySku = new Map<string, string[]>();\n"
                "  const orderBySku = new Map<string, number>();\n",
            ),
            (
                "collect order-side mods",
                "    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.sku ?? "").trim());\n'
                "  }\n",
                "    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.sku ?? "").trim());\n'
                "    if (it.modifications?.length) {\n"
                "      orderModsBySku.set(k, [...(orderModsBySku.get(k) ?? []), ...it.modifications]);\n"
                "    }\n"
                "  }\n",
            ),
            (
                "collect ack-side mods",
                "    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.composite_sku ?? "").trim());\n'
                "  }\n",
                "    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.composite_sku ?? "").trim());\n'
                "    if (it.modifications?.length) {\n"
                "      ackModsBySku.set(k, [...(ackModsBySku.get(k) ?? []), ...it.modifications]);\n"
                "    }\n"
                "  }\n",
            ),
            (
                "compare mods when both sides have the line",
                "    let status: LineStatus;\n"
                '    if (o !== null && a !== null) status = o === a ? "match" : "qty_mismatch";\n'
                '    else if (o !== null && a === null) status = "missing_from_ack";\n'
                '    else status = "extra_in_ack";\n'
                "    lines.push({ composite_sku: displayBySku.get(sku) ?? sku, status, order_qty: o, ack_qty: a });\n",
                "    const om = orderModsBySku.get(sku) ?? [];\n"
                "    const am = ackModsBySku.get(sku) ?? [];\n"
                "    const normMods = (xs: string[]) => xs.map(x => x.trim().toUpperCase()).sort();\n"
                "    const oN = normMods(om), aN = normMods(am);\n"
                "    const modsEqual = oN.length === aN.length && oN.every((m, i) => m === aN[i]);\n"
                "\n"
                "    let status: LineStatus;\n"
                "    if (o !== null && a !== null) {\n"
                "      // Quantity first: a wrong count is the bigger problem, and reporting one\n"
                "      // issue per line keeps the panel readable.\n"
                '      if (o !== a) status = "qty_mismatch";\n'
                '      else if (!modsEqual) status = "mod_mismatch";\n'
                '      else status = "match";\n'
                '    } else if (o !== null && a === null) status = "missing_from_ack";\n'
                '    else status = "extra_in_ack";\n'
                "\n"
                "    lines.push({\n"
                "      composite_sku: displayBySku.get(sku) ?? sku,\n"
                "      status,\n"
                "      order_qty: o,\n"
                "      ack_qty: a,\n"
                "      ...(om.length || am.length ? { order_mods: om, ack_mods: am } : {}),\n"
                "    });\n",
            ),
        ],
    ),
    # ── 4. the panel ────────────────────────────────────────────────────────
    (
        "components/AcknowledgmentPanel.tsx",
        "modifications differ",
        [
            (
                "lineIssue understands mod_mismatch",
                "function lineIssue(status: string, orderQty: number | null, ackQty: number | null): string {\n"
                '  if (status === "qty_mismatch") return `ordered ${orderQty}, acknowledged ${ackQty}`;\n'
                '  if (status === "missing_from_ack") return "on the order, missing from the acknowledgment";\n'
                '  if (status === "extra_in_ack") return "on the acknowledgment, not on the order";\n'
                "  return status;\n"
                "}\n",
                "function lineIssue(l: {\n"
                "  status: string;\n"
                "  order_qty: number | null;\n"
                "  ack_qty: number | null;\n"
                "  order_mods?: string[];\n"
                "  ack_mods?: string[];\n"
                "}): string {\n"
                '  if (l.status === "qty_mismatch") return `ordered ${l.order_qty}, acknowledged ${l.ack_qty}`;\n'
                '  if (l.status === "mod_mismatch") {\n'
                '    const o = (l.order_mods ?? []).join(", ") || "none";\n'
                '    const a = (l.ack_mods ?? []).join(", ") || "none";\n'
                "    return `modifications differ — order: ${o} · acknowledgment: ${a}`;\n"
                "  }\n"
                '  if (l.status === "missing_from_ack") return "on the order, missing from the acknowledgment";\n'
                '  if (l.status === "extra_in_ack") return "on the acknowledgment, not on the order";\n'
                "  return l.status;\n"
                "}\n",
            ),
            (
                "call site passes the line",
                "<span style={{ color: \"#e89090\" }}>{lineIssue(l.status, l.order_qty, l.ack_qty)}</span>",
                "<span style={{ color: \"#e89090\" }}>{lineIssue(l)}</span>",
            ),
        ],
    ),
]


def main():
    # Stage B builds on Stage A's skuKey/displayBySku shape.
    try:
        with io.open("lib/reconcile.ts", encoding="utf-8") as f:
            rec = f.read()
    except FileNotFoundError:
        print("ABORT: lib/reconcile.ts not found — run from ~/cabinet-orders. Wrote nothing.")
        sys.exit(1)
    if "function skuKey(" not in rec:
        print("ABORT: Stage A not applied. Run patch_ack_sku_match.py first. Wrote nothing.")
        sys.exit(1)

    staged = []
    for path, marker, edits in JOBS:
        try:
            with io.open(path, "r", encoding="utf-8") as f:
                src = f.read()
        except FileNotFoundError:
            print(f"ABORT: {path} not found. Wrote nothing.")
            sys.exit(1)
        if marker in src:
            print(f"skip: {path} already applied")
            continue
        out = src
        for label, old, new in edits:
            n = out.count(old)
            if n != 1:
                print(f"ABORT: [{path}] anchor '{label}' found {n} times (need exactly 1). Wrote nothing.")
                sys.exit(1)
            out = out.replace(old, new, 1)
            print(f"ok: [{path}] {label}")
        staged.append((path, out))

    if not staged:
        print("nothing to do — all files already patched")
        return
    for path, content in staged:
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("WROTE " + path)


if __name__ == "__main__":
    main()
