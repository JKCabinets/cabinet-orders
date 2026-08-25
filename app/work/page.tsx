import { WorkClient } from "./WorkClient";

/**
 * /work — the queue of purchases that need somebody.
 *
 * Opens on MY WORK. The two scopes (My work · Unclaimed) are client state
 * rather than routes, so switching does not reload the store or lose the reason
 * filter.
 *
 * ⚠ ONLY TWO SCOPES. "Team" and "All" were removed on 2026-08-25 -- Team
 * answered a question this page is not for (who else is busy), and All
 * duplicated the Projects page, which shows the same rows with more context.
 * Anything still linking to ?scope=team or ?scope=all lands on My work rather
 * than 404ing: an old bookmark should degrade, not break.
 */
export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const initial = scope === "unclaimed" ? "unclaimed" : "mine";
  return <WorkClient initialScope={initial} />;
}
