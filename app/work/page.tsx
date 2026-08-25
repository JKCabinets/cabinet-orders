import { WorkClient } from "./WorkClient";

/**
 * /work — the queue of everything that needs a person.
 *
 * Opens on MY WORK. The scope tabs (My work · Unclaimed · Team · All) are
 * client state rather than routes, so switching between them does not reload
 * the store or lose your reason filter.
 *
 * Dashboard cards link here with `?scope=` to land on the right tab.
 */
export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const initial =
    scope === "unclaimed" || scope === "team" || scope === "all" ? scope : "mine";
  return <WorkClient initialScope={initial} />;
}
