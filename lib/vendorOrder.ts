/**
 * The order vendor names are listed in -- ONE RULE, IN ONE PLACE (2026-11-18,
 * item 12; Garrett: "Sort with the server's own function, not a copy of it").
 *
 * ⚠ MOVED HERE FROM lib/vendorLookup, NOT COPIED. `resolveVendors` sorted its
 * `uniqueVendors` inline, and those names, in that order, are the keys of the
 * enrichment's `ackLines` and `proofLines` -- so the order of the band's rows.
 * The band now draws those rows before the enrichment answers
 * (components/NextActionPanel), so it must order them by the same rule, and
 * vendorLookup imports supabase, which the browser cannot. So the rule lives
 * here, pure, and both import it.
 *
 * ⚠ THE LOCALE IS PINNED. `localeCompare` with no locale asks the runtime's
 * default: the server's container (no LANG set, so Node answers "en-US") and
 * each person's browser, in whatever language it is set to. One function, two
 * orders wherever a locale differs -- in Danish or Turkish "HCI Cabinetry"
 * sorts before "hci cabinetry", in Czech "Ch" after "H". Pinned to "en-US",
 * the container's own default (checked on the box 2026-11-18), so the
 * server's order is unchanged and every browser orders as the server does.
 */
export function compareVendorNames(a: string, b: string): number {
  return a.localeCompare(b, "en-US");
}

/** Vendor names in the one order, as a new array. */
export function sortVendorNames(names: Iterable<string>): string[] {
  return Array.from(names).sort(compareVendorNames);
}
