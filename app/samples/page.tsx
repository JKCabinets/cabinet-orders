import { AppShell } from "@/components/AppShell";
import { SamplesClient } from "./SamplesClient";

export const metadata = { title: "Sample Orders \u2014 JK Cabinets" };

export default function SampleOrdersPage() {
  return (
    <AppShell>
      <SamplesClient />
    </AppShell>
  );
}
