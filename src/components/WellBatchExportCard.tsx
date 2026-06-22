import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportWellBatchZip } from "@/lib/export-well-batch";
import { useSharedWell } from "@/lib/shared-well-store";

export default function WellBatchExportCard() {
  const [busy, setBusy] = useState(false);
  const [shared] = useSharedWell();

  const run = async () => {
    setBusy(true);
    try {
      const res = await exportWellBatchZip();
      toast.success(`Сформирован ${res.filename}`, {
        description: res.modules.length
          ? `Включено: ${res.modules.join(", ")} + сводка`
          : "Включена только сводка (сессии модулей не обнаружены)",
      });
    } catch (e) {
      console.error(e);
      toast.error("Не удалось собрать пакетный отчёт");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4" />
          Пакетный DOCX по скважине
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Соберёт ZIP-архив: сводку по скважине + DOCX каждого модуля, где есть активная сессия (цементирование и др.).
          {shared.wellName && <> <br />Текущая скважина: <span className="font-medium text-foreground">{shared.wellName}</span></>}
        </div>
        <Button onClick={run} disabled={busy} size="sm">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Package className="w-4 h-4 mr-2" />}
          Скачать ZIP-пакет
        </Button>
      </CardContent>
    </Card>
  );
}
