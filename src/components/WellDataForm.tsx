import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WellData } from "@/lib/cementing-calculations";

interface Props {
  data: WellData;
  onChange: (data: WellData) => void;
}

const fields: { key: keyof WellData; label: string; unit: string }[] = [
  { key: "wellDepthMD", label: "Глубина скважины по стволу", unit: "м" },
  { key: "wellDepthTVD", label: "Глубина скважины по вертикали", unit: "м" },
  { key: "casingDepthMD", label: "Глубина спуска колонны", unit: "м" },
  { key: "holeDiameter", label: "Диаметр открытого ствола", unit: "мм" },
  { key: "casingOD", label: "Наружный диаметр колонны", unit: "мм" },
  { key: "casingID", label: "Внутренний диаметр колонны", unit: "мм" },
  { key: "casingWall", label: "Толщина стенки колонны", unit: "мм" },
  { key: "prevCasingDepth", label: "Глубина предыдущей колонны", unit: "м" },
  { key: "prevCasingID", label: "Внутр. диаметр пред. колонны", unit: "мм" },
  { key: "ckodDepth", label: "Глубина ЦКОД", unit: "м" },
  { key: "cementRiseHeight", label: "Высота подъёма цемента", unit: "м" },
  { key: "cavernCoeff", label: "Коэффициент кавернозности", unit: "" },
  { key: "mudDensity", label: "Плотность бурового раствора", unit: "г/см³" },
  { key: "bottomTemp", label: "Температура на забое", unit: "°C" },
  { key: "maxAngle", label: "Максимальный зенитный угол", unit: "°" },
  { key: "maxAngleDepth", label: "Глубина макс. угла", unit: "м" },
];

export default function WellDataForm({ data, onChange }: Props) {
  const handleChange = (key: keyof WellData, value: string) => {
    onChange({ ...data, [key]: parseFloat(value) || 0 });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Исходные данные скважины</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fields.map(({ key, label, unit }) => (
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
        </div>
      </CardContent>
    </Card>
  );
}
