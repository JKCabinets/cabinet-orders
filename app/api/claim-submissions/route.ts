import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/claim-submissions — the triage queue.
 *
 * ⚠ ITS OWN FETCH, NOT PART OF THE STORE. claim_submissions is not a view over
 *   `orders`, so it cannot ride the store's realtime channel or its shape.
 *   These are reports awaiting a decision, not rows in a flow.
 *
 * Until this existed, POST /api/public/claims wrote to a table nothing read.
 */

const STATUSES = new Set(["new", "promoted", "rejected"]);

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "claim-submissions:get");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "new";
  if (!STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 422 },
    );
  }

  // ⚠ EXPLICIT COLUMNS, NOT `*`. Every route on this box runs as the service
  // role, so the select list is the only thing deciding what leaves the
  // database. `*` would also survive a future column being added without
  // anyone deciding it should be readable here.
  const { data, error } = await supabase
    .from("claim_submissions")
    .select(
      "id, received_at, order_number_raw, order_number, delivered_on, claim_type, claimant_name, claimant_email, claimant_phone, message, policy_version, photo_paths, status, promoted_to_order_id, promoted_at, promoted_by, review_notes",
    )
    .eq("status", status)
    .order("received_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Which groups could each submission be about? The customer typed an order
  // number, which resolves to a PROJECT; a claim is about a GROUP. Resolving
  // the candidates here means the triage screen can offer a choice rather than
  // making the person look each one up by hand.
  const references = [...new Set(
    rows.map((r) => r.order_number).filter((v): v is string => !!v),
  )];

  let groupsByProject: Record<string, { id: string; type: string; stage: string; delivery_date: string | null }[]> = {};
  if (references.length > 0) {
    const { data: groups } = await supabase
      .from("orders")
      .select("id, type, stage, delivery_date, project_id")
      .in("project_id", references);

    groupsByProject = (groups ?? []).reduce((acc, g) => {
      const key = g.project_id as string;
      (acc[key] ??= []).push({
        id: g.id as string,
        type: g.type as string,
        stage: g.stage as string,
        delivery_date: (g.delivery_date as string | null) ?? null,
      });
      return acc;
    }, {} as typeof groupsByProject);
  }

  // ── Photos ───────────────────────────────────────────────────────────────
  //
  // ⚠ SIGNED URLS, MINTED HERE. The claim-photos bucket is private and has no
  // storage policies, so only the service role can read it -- which is the
  // point: these are photographs of somebody's home, submitted before anyone
  // has verified who they are. A raw path is useless to the browser, so the
  // review screen would show nothing and the person completing a damage claim
  // would be judging it blind.
  //
  // One hour. Long enough to work a queue, short enough that a URL pasted into
  // a chat stops working.
  const signedByPath = new Map<string, string>();
  const allPaths = rows.flatMap((r) => (Array.isArray(r.photo_paths) ? r.photo_paths : []));
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("claim-photos")
      .createSignedUrls(allPaths as string[], 3600);
    for (const entry of signed ?? []) {
      // A failed entry carries an error and no signedUrl. Skipped rather than
      // faked: a broken image is clearer than a link that goes nowhere.
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      photos: (Array.isArray(r.photo_paths) ? r.photo_paths : [])
        .map((path: string) => ({ path, url: signedByPath.get(path) ?? null })),
      // Empty when the typed number matched nothing. That is a real state, not
      // an error: the person promoting picks the group by hand and the raw
      // string is right there to work from.
      candidate_groups: r.order_number ? (groupsByProject[r.order_number] ?? []) : [],
    })),
  });
}
