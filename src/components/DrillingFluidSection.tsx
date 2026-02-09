import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DrillingFluid } from "@/lib/cementing-calculations";

interface Props {
  fluid: DrillingFluid;
  onChange: (fluid: DrillingFluid) => void;
  displacementDensity: number;
  onDisplacementDensityChange: (v: number) => void;
}

export default function DrillingFluidSection({ fluid, onChange, displacementDensity, onDisplacementDensityChange }: Props) {
  const update = (field: string, value: string) => {
    const num = parseFloat(value) || 0;
    if (field === "density") onChange({ ...fluid, density: num });
    else if (field === "pv") onChange({ ...fluid, rheology: { ...fluid.rheology, pv: num } });
    else if (field === "yp") onChange({ ...fluid, rheology: { ...fluid.rheology, yp: num } });
    else if (field === "fluidLoss") onChange({ ...fluid, fluidLoss: num });
    else if (field === "name") onChange({ ...fluid, name: value });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">03. Буровой раствор</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Тип бурового раствора</Label>
            <Input value={fluid.name} onChange={(e) => update("name", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Плотность бур. раствора, кг/м³</Label>
            <Input type="number" step="1" value={fluid.density || ""} onChange={(e) => update("density", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Плотность продавочной жидкости, кг/м³</Label>
            <Input type="number" step="1" value={displacementDensity || ""} onChange={(e) => onDisplacementDensityChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">PV (пласт. вязкость), сПз</Label>
            <Input type="number" step="1" value={fluid.rheology.pv || ""} onChange={(e) => update("pv", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">YP (ДНС), Па</Label>
            <Input type="number" step="0.1" value={fluid.rheology.yp || ""} onChange={(e) => update("yp", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Водоотдача, мл/30мин</Label>
            <Input type="number" step="1" value={fluid.fluidLoss || ""} onChange={(e) => update("fluidLoss", e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
