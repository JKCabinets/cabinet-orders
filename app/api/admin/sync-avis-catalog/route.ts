import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runAvisSync } from "@/lib/runAvisSync";

/**
 * POST /api/admin/sync-avis-catalog          (Step 5b)
 * POST /api/admin/sync-avis-catalog?apply=1
 *
 * The manual "Sync from Avis" button. DRY RUN unless ?apply=1.
 *
 * The work itself lives in lib/runAvisSync so this and the nightly cron
 * (app/api/cron/sync-avis-catalog) run identical code — a reconciliation this
 * fiddly must not exist twice.
 *
 * Admin only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const user = (auth as { session: { user: { username?: string; name?: string } } }).session.user;

  const apply = new URL(req.url).searchParams.get("apply") === "1";
  const result = await runAvisSync({ apply, ranBy: user.username ?? user.name ?? "admin" });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({
    ...result,
    ...result.counts,
    message: result.dry_run
      ? "Nothing was written. Re-run with ?apply=1 to make these changes."
      : undefined,
  });
}
