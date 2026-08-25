# Known-wrong — additions for `HANDOFF-2026-08-20-BUILD.md` §10

**2026-08-25.** Supersedes a draft of 2026-08-20 that listed two bulk-route
defects. Both are gone — not fixed, but **deleted along with the feature that
had them** when `/api/orders/bulk` became a cleanup tool. That is worth knowing
before reading further: two of the four instances below were closed by removing
code, not by correcting it.

---

# 1. ⚠ The pattern: one rule, two implementations, one missing a clause

**Four instances in six days.** Not four unrelated bugs — one recurring shape.
A rule gets enforced in two places, the second copy is written from memory of
the first, and a clause is left out. Nothing errors. The two paths simply
disagree, and which one you hit decides what happens.

| Rule | Places | What diverged |
|---|---|---|
| New → Entered needs an acknowledgment | `PATCH /api/orders/[id]`, `/api/orders/bulk` | Bulk counted attachments but never checked `orderAllVendorsGreen`, so it **refused** orders PATCH allows. Half the OR. |
| At cross dock → Delivered needs a receipt | `PATCH`, `/api/orders/bulk` | `proof_of_delivery` appeared nowhere in bulk. It skipped the gate entirely — no receipt, no reason, no activity row, while the single-order path demands all three. |
| Samples are exempt from the ack gate | `PATCH` (server), `OrderModal` (client) | The client gate checked the STAGE only. A sample was refused before the request was made, by a rule the server explicitly exempts it from. Hardware would have hit the same wall. |
| A stage must belong to the row's flow | `STAGE_LIST_BY_TYPE` (UI), `STAGE_ORDER_BY_TYPE` (index maths) | `DateEditor` offered production dates to a sample, whose flow has no In production — and saving one AUTO-ADVANCES there. See §3. |

**Why it keeps happening.** Every one of these rules is a business rule with a
carve-out, and the carve-out is the part that gets dropped. "Needs an
attachment" is easy to remember; "unless the acknowledgments are already green,
and never for samples" is not.

**What actually prevents it.** One implementation, called from both paths — not
a comment saying "mirrors the gate in X". Where a shared helper is impossible
because one side is client and the other server (`lib/stageGates.ts` fetches
`/api/orders/attachments`, so the server cannot call it), the two must at least
share the same predicate for WHO the rule applies to. That is the clause that
goes missing, every time.

---

# 2. Fixed 2026-08-24/25, recorded so it is not re-derived

- **The client ack gate now checks type.** `gateApplies = type !== "sample" &&
  type !== "hardware"`, matching the server.
- **`DateEditor` gates on the row's own flow**, not on stage names — it asks
  whether `STAGE_LIST_BY_TYPE[type]` contains `In production` / `At cross dock`.
- **Bulk lost its `move` action entirely.** Stage moves happen one order at a
  time, where the gates are. Bulk is archive and delete.
- **`production-complete` filters `.in("type", ["order","sample"])`** — an
  ALLOWLIST, so a new type is not automated by omission.

---

# 3. ⚠ STILL OPEN: `isStageAllowedForType` accepts a stage outside the UI flow

```ts
export function isStageAllowedForType(stage: string, type?: string | null) {
  const flow = type ? STAGE_ORDER_BY_TYPE[type] : undefined;
  ...
}
```

It reads **`STAGE_ORDER_BY_TYPE`**, which maps `sample` onto the full
`ORDER_STAGE_ORDER` — all five standard stages — because samples share that
array for backward-move index arithmetic. **`STAGE_LIST_BY_TYPE` is the flow a
row can actually take**: New → Entered → Delivered.

So the server would accept `PATCH { stage: "In production" }` on a sample. The
row would land at a stage its own rail cannot draw and its own page does not
list.

Nothing sends that today — `DateEditor` was the only caller that would have,
and it was fixed on 2026-08-25. But the hole is in the guard, not the caller,
and the next caller will not know.

**The fix is not simply switching the lookup.** `STAGE_ORDER_BY_TYPE` has to
keep mapping samples onto the standard array or backward-move detection and
`fieldsToClearOnBackwardMove` break. What is needed is a second, separate
predicate — "is this stage OFFERED for this type" — reading
`STAGE_LIST_BY_TYPE`, with `isStageAllowedForType` keeping its current meaning
of "does the index maths work". Two questions that have looked like one.

---

# 4. STILL OPEN: silent drops between the database and the types

**Four instances in two days.** A column or field exists in the database and in
the API routes, and the TypeScript type never learned about it — so every typed
caller is blind to real data, and nothing errors.

| | |
|---|---|
| `orders.shopify_id` | Exists, read by the webhook and by `webhook-health`. `shapeOrder` has never mapped it, so it does not reach the client `Order` at all. **Still true.** |
| `SkuItem.vendor` | Written by ingest since 2026-08-24. Declared 2026-08-24 only when the Full Order table tried to read it and tsc objected. |
| `Order.total_price` | Column, CHECK constraint and both API routes shipped 2026-08-24; the interface did not. Declared 2026-08-25. |
| `store.addOrder` | Builds an explicit payload whitelist, not a spread. A field missing from it is dropped with no error — `total_price` was, until 2026-08-25. |

`addOrder` is the one worth watching: it is not a type problem, so tsc cannot
catch it. **Any new field on the create path must be added there by hand**, and
forgetting is invisible.

---

# 5. STILL OPEN: custom orders get no backward-move clearing

```ts
// Warranty has no date-driven transitions. Custom orders DO have
// production and delivery stages, but their indices differ from
// ORDER_STAGE_ORDER ... clearing is deliberately skipped for now
if (target.flow !== "order") return null;
```

For warranty this is correct and load-bearing — `reported_at` and the claim's
link must survive a backward move. For custom orders it is a gap the comment
itself acknowledges: dragged back from At cross dock to In review, a custom
order keeps its delivery dates.

⚠ **If that early return is ever narrowed**, `reported_at` and `about_order_id`
must be explicitly excluded. `reported_at` carries the 48-hour window from Terms
§12.3; clearing the claim link would strand the claim. The list of fields is not
the hazard — the early return is.
