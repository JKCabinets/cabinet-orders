/**
 * A variant's COLOR OPTION value (2026-10-28, item 60) -- how HCI shows its
 * finish, its SKUs carrying none (B30 is "BASE CABINET - Signature Blue / 30").
 * Found by the option's NAME, not its position, so a product listing its
 * options in another order still reads right. null: no Color option.
 *
 * ONE reading, for the Sync and the product webhook alike, so the two cannot
 * disagree about what a variant's colour is. sku_judge_discontinued() compares
 * it, case-insensitively, with HCI's colour mappings.
 */
export function colorOptionOf(product: Record<string, unknown>, variant: Record<string, unknown>): string | null {
  const options = Array.isArray(product.options) ? (product.options as { name?: unknown; position?: unknown }[]) : [];
  const i = options.findIndex((o) => /^colou?r$/i.test(String(o?.name ?? "").trim()));
  if (i < 0) return null;
  const position = Number(options[i]?.position ?? i + 1);
  const value = variant[`option${position}`];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
