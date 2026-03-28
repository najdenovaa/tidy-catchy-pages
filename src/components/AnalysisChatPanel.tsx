import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import FollowUpChat from "@/components/FollowUpChat";
import type { WellData } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  sourceDocuments: string[];
}

export default function AnalysisChatPanel({ wellData, sourceDocuments }: Props) {
  const [open, setOpen] = useState(false);

  const reportContext = `Программа цементирования составлена на основе документов: ${sourceDocuments.join(", ")}.\n\nДанные скважины: глубина ${wellData.wellDepthMD}м, ОК ${wellData.casingOD}мм, ствол ${wellData.holeDiameter}мм, ЦКОД ${wellData.ckodDepth}м.`;

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 rounded-full w-14 h-14 shadow-lg bg-primary hover:bg-primary/90 p-0"
        title="Задать вопрос по программе"
      >
        <MessageSquare className="w-6 h-6" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <span className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Вопросы по программе
        </span>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <FollowUpChat reportContext={reportContext} />
      </div>
    </div>
  );
}
