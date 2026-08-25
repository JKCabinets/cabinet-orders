import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { OrdersHubClient } from "@/components/OrdersHubClient";
import { VALID_STAGE_SLUGS, resolveOrdersSlug } from "./stageSlugs";

interface OrdersPageProps {
  params: Promise<{ stage: string }>;
}

export default async function OrdersPage({ params }: OrdersPageProps) {
  const { stage: slug } = await params;
  const resolved = resolveOrdersSlug(slug);
  if (!resolved) notFound();
  return (
    <AppShell>
      <OrdersHubClient
        type={resolved.type}
        initialStage={resolved.initialStage}
        archive={resolved.archive}
      />
    </AppShell>
  );
}

export async function generateStaticParams() {
  return VALID_STAGE_SLUGS.map((slug) => ({ stage: slug }));
}
