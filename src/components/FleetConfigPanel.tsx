import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Save, Settings, ChevronDown, ChevronUp } from "lucide-react";

interface FleetConfig {
  id: string;
  fleet_number: number;
  is_online: boolean;
  brigade: string;
  operation: string;
  field_name: string;
  well_number: string;
  customer: string;
  signal_type: string;
  pressure: number;
  rate: number;
  density: number;
  volume: number;
  temperature: number;
  tank1_capacity: number;
  tank1_level: number;
  tank2_capacity: number;
  tank2_level: number;
  engine1_rpm: number;
  engine2_rpm: number;
  casing_diameter: string;
}

export default function FleetConfigPanel() {
  const [configs, setConfigs] = useState<FleetConfig[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    const { data } = await supabase
      .from("fleet_configs")
      .select("*")
      .order("fleet_number");
    if (data) setConfigs(data as unknown as FleetConfig[]);
  };

  const updateConfig = (fleetNum: number, field: keyof FleetConfig, value: any) => {
    setConfigs(prev =>
      prev.map(c =>
        c.fleet_number === fleetNum ? { ...c, [field]: value } : c
      )
    );
  };

  const toggleOnline = async (fleetNum: number, val: boolean) => {
    updateConfig(fleetNum, "is_online", val);
    await supabase
      .from("fleet_configs")
      .update({ is_online: val } as any)
      .eq("fleet_number", fleetNum);
    toast({ title: `${fleetNum} флот: ${val ? "ONLINE" : "OFFLINE"}` });
  };

  const saveFleet = async (fleetNum: number) => {
    setSaving(fleetNum);
    const cfg = configs.find(c => c.fleet_number === fleetNum);
    if (!cfg) return;

    const { id, fleet_number, ...updates } = cfg;
    await supabase
      .from("fleet_configs")
      .update(updates as any)
      .eq("fleet_number", fleetNum);

    toast({ title: `Параметры ${fleetNum} флота сохранены` });
    setSaving(null);
  };

  const renderField = (
    fleetNum: number,
    label: string,
    field: keyof FleetConfig,
    type: "text" | "number" = "text",
    unit?: string
  ) => {
    const cfg = configs.find(c => c.fleet_number === fleetNum);
    if (!cfg) return null;
    return (
      <div>
        <Label className="text-[11px] text-muted-foreground">
          {label}{unit ? ` (${unit})` : ""}
        </Label>
        <Input
          className="h-7 text-xs"
          type={type}
          step={type === "number" ? "0.01" : undefined}
          value={cfg[field] as string | number}
          onChange={e =>
            updateConfig(
              fleetNum,
              field,
              type === "number" ? parseFloat(e.target.value) || 0 : e.target.value
            )
          }
        />
      </div>
    );
  };

  return (
    <Card className="mb-6">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="w-4 h-4" /> Управление флотами (демо-режим)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {configs.map(cfg => {
          const isExpanded = expanded === cfg.fleet_number;
          return (
            <div
              key={cfg.fleet_number}
              className="border border-border rounded-lg overflow-hidden"
            >
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                <p className="text-sm font-medium flex-1">
                  {cfg.fleet_number} флот
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {cfg.is_online ? "Online" : "Offline"}
                  </span>
                  <Switch
                    checked={cfg.is_online}
                    onCheckedChange={val => toggleOnline(cfg.fleet_number, val)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    setExpanded(isExpanded ? null : cfg.fleet_number)
                  }
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* Expanded config */}
              {isExpanded && (
                <div className="px-4 py-3 space-y-4">
                  {/* Info */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      📋 Информация
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {renderField(cfg.fleet_number, "Бригада", "brigade")}
                      {renderField(cfg.fleet_number, "Операция", "operation")}
                      {renderField(cfg.fleet_number, "Диам. колонны", "casing_diameter")}
                      {renderField(cfg.fleet_number, "Месторождение", "field_name")}
                      {renderField(cfg.fleet_number, "Скважина №", "well_number")}
                      {renderField(cfg.fleet_number, "Заказчик", "customer")}
                    </div>
                  </div>

                  {/* Signal */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      📡 Сигнал
                    </p>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={`signal-${cfg.fleet_number}`}
                          checked={cfg.signal_type === "gprs"}
                          onChange={() =>
                            updateConfig(cfg.fleet_number, "signal_type", "gprs")
                          }
                        />
                        GPRS
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={`signal-${cfg.fleet_number}`}
                          checked={cfg.signal_type === "satellite"}
                          onChange={() =>
                            updateConfig(
                              cfg.fleet_number,
                              "signal_type",
                              "satellite"
                            )
                          }
                        />
                        Спутник ГП ЯМАЛ 401
                      </label>
                    </div>
                  </div>

                  {/* Chart parameters */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      📊 Параметры графика
                    </p>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {renderField(cfg.fleet_number, "Давление", "pressure", "number", "МПа")}
                      {renderField(cfg.fleet_number, "Расход", "rate", "number", "л/с")}
                      {renderField(cfg.fleet_number, "Плотность", "density", "number", "г/см³")}
                      {renderField(cfg.fleet_number, "Объём", "volume", "number", "м³")}
                      {renderField(cfg.fleet_number, "Температура", "temperature", "number", "°C")}
                    </div>
                  </div>

                  {/* Equipment */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      ⚙️ Оборудование
                    </p>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {renderField(cfg.fleet_number, "Ёмкость 1", "tank1_capacity", "number", "м³")}
                      {renderField(cfg.fleet_number, "Уровень 1", "tank1_level", "number", "м³")}
                      {renderField(cfg.fleet_number, "Ёмкость 2", "tank2_capacity", "number", "м³")}
                      {renderField(cfg.fleet_number, "Уровень 2", "tank2_level", "number", "м³")}
                      {renderField(cfg.fleet_number, "Двигатель 1", "engine1_rpm", "number", "RPM")}
                      {renderField(cfg.fleet_number, "Двигатель 2", "engine2_rpm", "number", "RPM")}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveFleet(cfg.fleet_number)}
                      disabled={saving === cfg.fleet_number}
                    >
                      <Save className="w-3 h-3 mr-1" />
                      {saving === cfg.fleet_number
                        ? "Сохранение..."
                        : "Сохранить параметры"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
