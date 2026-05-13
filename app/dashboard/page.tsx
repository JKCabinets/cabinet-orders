import { AppShell } from "@/components/AppShell";
import { DashboardClient } from "./DashboardClient";

export const metadata = { title: "Dashboard — JK Cabinets" };

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardClient />
    </AppShell>
  );
}
