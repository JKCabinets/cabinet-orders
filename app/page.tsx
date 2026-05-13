import { redirect } from "next/navigation";

/**
 * The root path now redirects to /dashboard. The old kanban board has been
 * replaced by per-stage pages reachable via the sidebar.
 */
export default function HomePage() {
  redirect("/dashboard");
}
