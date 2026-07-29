import { AppShell } from "@/components/AppShell";
import { CustomClient } from "./CustomClient";

export const metadata = { title: "Custom Orders \u2014 JK Cabinets" };

export default function CustomOrdersPage() {
  return (
    <AppShell>
      <CustomClient />
    </AppShell>
  );
}
