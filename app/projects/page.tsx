import { AppShell } from "@/components/AppShell";
import { ProjectsClient } from "./ProjectsClient";

export const metadata = { title: "Projects \u2014 JK Cabinets" };

export default function ProjectsPage() {
  return (
    <AppShell>
      <ProjectsClient />
    </AppShell>
  );
}
