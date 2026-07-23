#!/usr/bin/env python3
"""Ack reconciliation Stage A — stop reporting one cabinet as two discrepancies.

Waypoint's acknowledgment writes a manual door modifier space-separated
("B24 BUTT") while the OMS composite hyphenates it ("B24-BUTT"). The old
normSku() stripped whitespace but not hyphens, so the two spellings became two
different map keys and the same cabinet was reported BOTH as missing_from_ack
AND extra_in_ack.

  1. lib/waypointAck.ts — reconstruct the composite with the OMS's hyphenated
     spelling (internal whitespace -> "-"), so stored/parsed data is canonical.
  2. lib/reconcile.ts   — match on a separator-insensitive key (alphanumerics
     only) as a second line of defence, while DISPLAYING the original spelling
     (the order's form preferred) so the UI still shows a real SKU.

No new statuses and no shape changes, so the UI needs no edit.
Validates ALL anchors before writing ANY. Idempotent.
"""
import sys, io

JOBS = [
    (
        "lib/waypointAck.ts",
        'replace(/\\s+/g, "-")',
        [
            (
                "hyphenate multi-token base sku",
                "        const base = desc.trim();\n",
                "        // Waypoint spells a manual door modifier with a space (\"B24 BUTT\");\n"
                "        // our composite hyphenates it (\"B24-BUTT\"). Normalize the internal\n"
                "        // whitespace so the reconstructed composite matches the OMS form.\n"
                "        const base = desc.trim().replace(/\\s+/g, \"-\");\n",
            ),
        ],
    ),
    (
        "lib/reconcile.ts",
        "function skuKey(",
        [
            (
                "normSku -> separator-insensitive skuKey",
                "/** Normalize a composite SKU for comparison. */\n"
                "function normSku(s: string): string {\n"
                '  return (s ?? "").replace(/\\s+/g, "").trim().toUpperCase();\n'
                "}\n",
                "/**\n"
                " * Canonical key for SKU matching — alphanumerics only, uppercased.\n"
                " *\n"
                " * Vendors spell the same cabinet with different separators: Waypoint's ack\n"
                ' * writes "B24 BUTT" where our composite is "B24-BUTT". Comparing raw strings\n'
                " * put them in different buckets and reported ONE cabinet as TWO discrepancies\n"
                " * (missing_from_ack + extra_in_ack). Matching on separator-stripped keys fixes\n"
                " * that; the original spelling is preserved separately for display.\n"
                " */\n"
                "function skuKey(s: string): string {\n"
                '  return (s ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();\n'
                "}\n",
            ),
            (
                "build maps on skuKey + keep display spelling",
                "  const orderBySku = new Map<string, number>();\n"
                "  for (const it of order.sku_items) {\n"
                "    const k = normSku(it.sku);\n"
                "    if (!k) continue;\n"
                "    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));\n"
                "  }\n"
                "  const ackBySku = new Map<string, number>();\n"
                "  for (const it of ack.items) {\n"
                "    const k = normSku(it.composite_sku);\n"
                "    if (!k) continue;\n"
                "    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));\n"
                "  }\n",
                "  // Display spelling per key. The ORDER's form wins because it is our\n"
                "  // canonical composite; the ack's spelling is the fallback for lines that\n"
                "  // only Waypoint has (extra_in_ack), which would otherwise have no display.\n"
                "  const displayBySku = new Map<string, string>();\n"
                "  const orderBySku = new Map<string, number>();\n"
                "  for (const it of order.sku_items) {\n"
                "    const k = skuKey(it.sku);\n"
                "    if (!k) continue;\n"
                "    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.sku ?? "").trim());\n'
                "  }\n"
                "  const ackBySku = new Map<string, number>();\n"
                "  for (const it of ack.items) {\n"
                "    const k = skuKey(it.composite_sku);\n"
                "    if (!k) continue;\n"
                "    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));\n"
                '    if (!displayBySku.has(k)) displayBySku.set(k, (it.composite_sku ?? "").trim());\n'
                "  }\n",
            ),
            (
                "display the original spelling in LineResult",
                "    lines.push({ composite_sku: sku, status, order_qty: o, ack_qty: a });\n",
                "    lines.push({ composite_sku: displayBySku.get(sku) ?? sku, status, order_qty: o, ack_qty: a });\n",
            ),
        ],
    ),
]


def main():
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
