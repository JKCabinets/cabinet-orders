import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { StagePageClient } from "./StagePageClient";
import { VALID_STAGE_SLUGS, slugToStage } from "./stageSlugs";

interface StagePageProps {
  params: Promise<{ stage: string }>;
}

const VALID_SLUGS_RUNTIME: readonly string[] = VALID_STAGE_SLUGS;

export default async function StagePage({ params }: StagePageProps) {
  const { stage: slug } = await params;
  if (!VALID_SLUGS_RUNTIME.includes(slug)) notFound();
  const stage = slugToStage(slug);
  return (
    <AppShell>
      <StagePageClient stage={stage} />
    </AppShell>
  );
}

export async function generateStaticParams() {
  return VALID_STAGE_SLUGS.map(slug => ({ stage: slug }));
}
