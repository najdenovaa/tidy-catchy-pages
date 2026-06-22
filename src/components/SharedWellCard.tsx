import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Database, Download, Upload, Trash2 } from "lucide-react";
import {
  useSharedWell,
  setSharedWell,
  clearSharedWell,
  type SharedWellData,
} from "@/lib/shared-well-store";

interface Props {
  /** Which module is this card embedded in — for source-tagging. */
  module: NonNullable<SharedWellData["source"]>;
  /** Snapshot of current module's well params to push to the shared store. */
  current: Partial<SharedWellData>;
  /** Apply shared data back to module-local state. */
  onApply: (data: SharedWellData) => void;
}

const FIELD_LABELS: Partial<Record<keyof SharedWellData, string>> = {
  wellName: "Скважина",
  fieldName: "Месторождение",
  wellDepthMD: "Глубина MD, м",
  wellDepthTVD: "Глубина TVD, м",
  holeDiameter: "Ø ствола, мм",
  casingShoe: "Башмак ОК, м",
  casingID: "ID ОК, мм",
  reservoirTopMD: "Кровля пласта, м",
  reservoirBottomMD: "Подошва пласта, м",
  reservoirPressureMPa: "P пл, МПа",
  reservoirTempC: "T пл, °C",
  mudDensity: "ρ ПЖ, кг/м³",
};

const SOURCE_LABEL: Record<NonNullable<SharedWellData["source"]>, string> = {
  "cement-plug": "Цементные мосты",
  stimulation: "Стимуляция",
  cementing: "Цементирование",
  manual: "Вручную",
};

export function SharedWellCard({ module, current, onApply }: Props) {
  const [shared] = useSharedWell();
  const [open, setOpen] = useState(false);
  const hasShared = shared.updatedAt !== undefined;

  const push = () => {
    setSharedWell(current, module);
    toast.success("Данные скважины опубликованы для других модулей");
  };
  const pull = () => {
    if (!hasShared) return;
    onApply(shared);
    toast.success(`Применены данные из «${SOURCE_LABEL[shared.source ?? "manual"]}»`);
  };
  const wipe = () => {
    clearSharedWell();
    toast.message("Общие данные очищены");
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4" />
            Общие данные скважины
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            {hasShared && (
              <Badge variant="secondary">
                {SOURCE_LABEL[shared.source ?? "manual"]}
                {shared.updatedAt && ` · ${new Date(shared.updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
              {open ? "Скрыть" : "Подробнее"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={push}>
            <Upload className="w-4 h-4 mr-1" /> Опубликовать из этого модуля
          </Button>
          <Button size="sm" variant="secondary" onClick={pull} disabled={!hasShared}>
            <Download className="w-4 h-4 mr-1" /> Применить общие
          </Button>
          {hasShared && (
            <Button size="sm" variant="ghost" onClick={wipe}>
              <Trash2 className="w-4 h-4 mr-1" /> Очистить
            </Button>
          )}
        </div>
        {open && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm pt-2 border-t">
            {hasShared ? (
              Object.entries(FIELD_LABELS).map(([k, label]) => {
                const v = (shared as Record<string, unknown>)[k];
                if (v === undefined || v === null || v === "") return null;
                return (
                  <div key={k} className="flex flex-col">
                    <span className="text-muted-foreground text-xs">{label}</span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                );
              })
            ) : (
              <div className="text-muted-foreground text-sm col-span-full">
                Пока нет общих данных. Заполните параметры в любом модуле и нажмите «Опубликовать».
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
