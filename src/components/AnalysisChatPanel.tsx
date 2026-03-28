import { MessageSquare } from "lucide-react";
import FollowUpChat from "@/components/FollowUpChat";
import type { WellData } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  sourceDocuments: string[];
}

export default function AnalysisChatPanel({ wellData, sourceDocuments }: Props) {
  const reportContext = `Программа цементирования составлена на основе документов: ${sourceDocuments.join(", ")}.\n\nДанные скважины: глубина ${wellData.wellDepthMD}м, ОК ${wellData.casingOD}мм, ствол ${wellData.holeDiameter}мм, ЦКОД ${wellData.ckodDepth}м.`;

  return (
    <div className="flex flex-col h-full bg-background border-r border-border">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        <MessageSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Вопросы по программе</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <FollowUpChat reportContext={reportContext} />
      </div>
    </div>
  );
}
