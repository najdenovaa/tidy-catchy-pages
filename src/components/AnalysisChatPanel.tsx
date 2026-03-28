import { useState } from "react";
import { MessageSquare, ChevronLeft, ChevronRight, X, ChevronUp, ChevronDown } from "lucide-react";
import FollowUpChat from "@/components/FollowUpChat";
import type { WellData } from "@/lib/cementing-calculations";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  wellData: WellData;
  sourceDocuments: string[];
}

export default function AnalysisChatPanel({ wellData, sourceDocuments }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  const reportContext = `Программа цементирования составлена на основе документов: ${sourceDocuments.join(", ")}.\n\nДанные скважины: глубина ${wellData.wellDepthMD}м, ОК ${wellData.casingOD}мм, ствол ${wellData.holeDiameter}мм, ЦКОД ${wellData.ckodDepth}м.`;

  if (isMobile) {
    // Mobile: bottom panel
    if (collapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="text-sm font-medium">Чат</span>
          <ChevronUp className="w-4 h-4" />
        </button>
      );
    }

    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[50vh] bg-background border-t border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Вопросы по программе</span>
          </div>
          <button onClick={() => setCollapsed(true)} className="p-1 rounded hover:bg-muted transition-colors">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FollowUpChat reportContext={reportContext} />
        </div>
      </div>
    );
  }

  // Desktop: left sidebar
  if (collapsed) {
    return (
      <div className="w-10 min-w-10 max-h-screen sticky top-0 flex flex-col items-center border-r border-border bg-muted/20">
        <button
          onClick={() => setCollapsed(false)}
          className="mt-3 p-2 rounded-md hover:bg-muted transition-colors"
          title="Открыть чат"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => setCollapsed(false)}
          className="mt-2 p-2 rounded-md hover:bg-muted transition-colors"
          title="Открыть чат"
        >
          <MessageSquare className="w-4 h-4 text-primary" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[340px] min-w-[340px] max-h-screen sticky top-0 flex flex-col border-r border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Вопросы по программе</span>
        </div>
        <button onClick={() => setCollapsed(true)} className="p-1 rounded-md hover:bg-muted transition-colors" title="Свернуть">
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <FollowUpChat reportContext={reportContext} />
      </div>
    </div>
  );
}
