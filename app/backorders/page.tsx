import { AppShell } from "@/components/AppShell";
import { BackordersClient } from "./BackordersClient";

export const metadata = { title: "Backorders — JK Cabinets" };

export default function BackordersPage() {
  return (
    <AppShell>
      <BackordersClient />
    </AppShell>
  );
}
