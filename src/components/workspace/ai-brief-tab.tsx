import { AiBriefCard } from "@/components/workspace/ai-brief-card";
import type { AiDealBrief } from "@/lib/types";

export function AiBriefTab({ leadId, brief, canContract }: { leadId: string; brief: AiDealBrief | null; canContract: boolean }) {
  return <AiBriefCard brief={brief} leadId={leadId} canContract={canContract} />;
}
