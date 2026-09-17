import { AppShell } from "@/components/AppShell";
import { ArchiveClient } from "@/components/ArchiveClient";

export const metadata = { title: "Archive \u2014 JK Cabinets" };

/**
 * /archive — everything that has been archived, of every kind.
 *
 * ⚠ ITS OWN SECTION, NOT A FILTER ON A HUB (decided 2026-09-16). The projects
 * hub is where active work lives; the archive is history, browsed and restored,
 * and generally by different people. It had been a filter on the projects hub
 * that listed purchases with no parts at all, because `allOrders` hides the
 * groups of an archived purchase -- see ArchiveClient for what it reads
 * instead.
 */
export default function ArchivePage() {
  return (
    <AppShell>
      <ArchiveClient />
    </AppShell>
  );
}
