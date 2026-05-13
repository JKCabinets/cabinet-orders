import { AppShell } from "@/components/AppShell";
import { WarrantyClient } from "./WarrantyClient";

export const metadata = { title: "Warranty — JK Cabinets" };

export default function WarrantyPage() {
  return (
    <AppShell>
      <WarrantyClient />
    </AppShell>
  );
}
