import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { StagePageClient, VALID_STAGE_SLUGS, slugToStage } from "./StagePageClient";

interface StagePageProps {
  params: Promise<{ stage: string }>;
}

export default async function StagePage({ params }: StagePageProps) {
  const { stage: slug } = await params;
  if (!VALID_STAGE_SLUGS.includes(slug)) notFound();
  const stage = slugToStage(slug);
  return (
    <AppShell>
      <StagePageClient stage={stage} slug={slug} />
    </AppShell>
  );
}

// Pre-generate the known stage routes so they're static where possible
export async function generateStaticParams() {
  return VALID_STAGE_SLUGS.map(slug => ({ stage: slug }));
}
