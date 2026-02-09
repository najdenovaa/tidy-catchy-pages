import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Equipment } from "@/lib/cementing-calculations";

interface Props {
  equipment: Equipment;
  onChange: (eq: Equipment) => void;
}

export default function EquipmentSection({ equipment, onChange }: Props) {
  const updateField = (field: "smn20" | "ca" | "skc", value: string) => {
    onChange({ ...equipment, [field]: parseInt(value) || 0 });
  };

  const updatePersonnel = (idx: number, field: "role" | "count", value: string) => {
    const updated = [...equipment.personnel];
    if (field === "role") {
      updated[idx] = { ...updated[idx], role: value };
    } else {
      updated[idx] = { ...updated[idx], count: parseInt(value) || 0 };
    }
    onChange({ ...equipment, personnel: updated });
  };

  const addPersonnel = () => {
    onChange({ ...equipment, personnel: [...equipment.personnel, { role: "", count: 1 }] });
  };

  const removePersonnel = (idx: number) => {
    onChange({ ...equipment, personnel: equipment.personnel.filter((_, i) => i !== idx) });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">02. Техника и персонал</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-3">Тампонажная техника</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">СМН-20, шт</Label>
              <Input type="number" value={equipment.smn20 || ""} onChange={(e) => updateField("smn20", e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">ЦА (цем. агрегат), шт</Label>
              <Input type="number" value={equipment.ca || ""} onChange={(e) => updateField("ca", e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">СКЦ, шт</Label>
              <Input type="number" value={equipment.skc || ""} onChange={(e) => updateField("skc", e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Персонал / Состав бригады</h3>
            <button onClick={addPersonnel} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              + Добавить
            </button>
          </div>
          <div className="space-y-2">
            {equipment.personnel.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <Input
                  value={p.role}
                  onChange={(e) => updatePersonnel(idx, "role", e.target.value)}
                  placeholder="Должность"
                  className="h-9 text-sm flex-1"
                />
                <Input
                  type="number"
                  value={p.count || ""}
                  onChange={(e) => updatePersonnel(idx, "count", e.target.value)}
                  className="h-9 text-sm w-20"
                />
                <span className="text-xs text-muted-foreground">чел.</span>
                {equipment.personnel.length > 1 && (
                  <button onClick={() => removePersonnel(idx)} className="text-xs text-destructive hover:underline">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
