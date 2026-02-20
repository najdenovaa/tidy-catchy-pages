import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WellData } from "@/lib/cementing-calculations";
import { getCasingID } from "@/lib/cementing-calculations";

interface Props {
  data: WellData;
  onChange: (data: WellData) => void;
}

type WellNumericKey = Exclude<keyof WellData, 'trajectory' | 'casingSections' | 'cavernIntervals'>;
const wellFields: { key: WellNumericKey; label: string; unit: string }[] = [
  { key: "wellDepthMD", label: "Глубина скважины (MD)", unit: "м" },
  { key: "wellDepthTVD", label: "Глубина скважины (TVD)", unit: "м" },
  { key: "casingDepthMD", label: "Глубина спуска ОК (MD)", unit: "м" },
  { key: "holeDiameter", label: "Номинальный диаметр ствола", unit: "мм" },
  { key: "casingOD", label: "Наружный диаметр ОК", unit: "мм" },
  { key: "casingWall", label: "Толщина стенки ОК", unit: "мм" },
  { key: "prevCasingDepth", label: "Глубина пред. колонны (MD)", unit: "м" },
  { key: "prevCasingOD", label: "Наружный диам. пред. колонны", unit: "мм" },
  { key: "prevCasingID", label: "Внутр. диам. пред. колонны", unit: "мм" },
  { key: "ckodDepth", label: "Глубина ЦКОД (MD)", unit: "м" },
  { key: "cementRiseHeight", label: "Высота подъёма цемента", unit: "м" },
  { key: "cavernCoeff", label: "Коэффициент кавернозности", unit: "" },
  { key: "bottomTempStatic", label: "BHST (статическая t°)", unit: "°C" },
  { key: "bottomTempCirc", label: "BHCT (циркуляционная t°)", unit: "°C" },
];

export default function WellDataForm({ data, onChange }: Props) {
  const handleChange = (key: WellNumericKey, value: string) => {
    onChange({ ...data, [key]: parseFloat(value) || 0 });
  };

  const casingID = getCasingID(data.casingOD, data.casingWall);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">01. Исходные данные</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {wellFields.map(({ key, label, unit }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={key} className="text-xs text-muted-foreground">
                {label}{unit && `, ${unit}`}
              </Label>
              <Input
                id={key}
                type="number"
                step="any"
                value={data[key] || ""}
                onChange={(e) => handleChange(key, e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Внутр. диаметр ОК (расчёт), мм</Label>
            <div className="h-9 flex items-center px-3 rounded-md bg-muted text-sm font-semibold border border-border">
              {casingID.toFixed(1)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
