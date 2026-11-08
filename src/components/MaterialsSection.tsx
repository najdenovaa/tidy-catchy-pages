import CementingEquipmentCard from "./CementingEquipmentCard";
import type { WellData } from "@/lib/cementing-calculations";
import { equipmentMaterialInventory, centralizerMaterialGeometryKey } from "@/lib/materials-equipment-inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MaterialSummary } from "@/lib/cementing-calculations";

interface Props {
  materials?: MaterialSummary | null;
  wellData: WellData;
  onWellDataChange: (w: WellData) => void;
}

const fmt = (v: number, dec: number = 1) => v.toFixed(dec);

export default function MaterialsSection({ materials, wellData, onWellDataChange }: Props) {
  const equipment = equipmentMaterialInventory(wellData);
  return (
    <div className="space-y-6">
      <CementingEquipmentCard well={wellData} onChange={onWellDataChange} />
      {!materials && <p className="text-sm text-muted-foreground">Выберите оснастку, затем нажмите «Расчёт» для ведомости цемента, реагентов и воды.</p>}
      {materials && <><Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Ведомость материалов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Цемент */}
          <div>
            <h3 className="text-sm font-medium mb-2">Цементные материалы</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Наименование</TableHead>
                  <TableHead className="text-xs text-right">Количество</TableHead>
                  <TableHead className="text-xs text-right">Ед. изм.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.cementItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{item.name}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{fmt(item.amount, item.unit === "т" ? 2 : 1)}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{item.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Буферы */}
          <div>
            <h3 className="text-sm font-medium mb-2">Буферные жидкости</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Наименование</TableHead>
                  <TableHead className="text-xs text-right">Количество</TableHead>
                  <TableHead className="text-xs text-right">Ед. изм.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.bufferItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{item.name}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{fmt(item.amount)}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{item.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Оснастка */}
          <div>
            <h3 className="text-sm font-medium mb-2">Технологическая оснастка</h3>
            {wellData.centralizerMaterials && <p className="text-xs text-muted-foreground mb-2">{wellData.centralizerMaterials.geometryKey===centralizerMaterialGeometryKey(wellData)?'Количество центраторов взято из рассчитанной расстановки. Ручные позиции центраторов повторно не прибавляются.':'Геометрия скважины изменилась. Пересчитайте центрирование для актуального количества центраторов.'}</p>}
            <Table>
              <TableBody>
                {!equipment.length && <TableRow><TableCell colSpan={3}>Оснастка не выбрана. Центраторы появятся после расчёта расстановки.</TableCell></TableRow>}
                {equipment.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{item.name}<p className="text-xs text-muted-foreground">{item.manufacturer} · {item.calculated ? "По расчёту центрирования" : "По комплектации"}</p>{item.details && <p className="text-xs text-muted-foreground">{item.details}</p>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline">Источник изготовителя</a>}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{item.amount}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{item.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Вода */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Вода для приготовления</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Буферной жидкости</span>
              <span className="text-sm font-semibold">{fmt(materials.waterForBuffers)} м³</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Затворения цемента</span>
              <span className="text-sm font-semibold">{fmt(materials.waterForCement)} м³</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Запас (10%)</span>
              <span className="text-sm font-semibold">{fmt(materials.waterReserve)} м³</span>
            </div>
            <div className="flex items-center justify-between py-2 font-semibold">
              <span className="text-sm">Всего воды</span>
              <span className="text-sm">{fmt(materials.waterTotal)} м³</span>
            </div>
          </div>
        </CardContent>
      </Card></>}
    </div>
  );
}
