import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";

interface Field { id: string; name: string; }
interface Pad { id: string; name: string; field_id: string; }
interface Well { id: string; name: string; well_pad_id: string; }

export interface SaveCalcPayload {
  module: "cementing" | "cement-plug" | "coiled-tubing" | "cementing-analysis";
  title: string;
  well_data: unknown;
  calc_params: unknown;
  results: unknown;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  /** Pre-selected well from URL (when opened from Dashboard). If set & calcId is set, will update in place. */
  initialWellId?: string | null;
  /** If set, updates this existing record instead of inserting. */
  calcId?: string | null;
  buildPayload: () => SaveCalcPayload;
  onSaved?: (calcId: string) => void;
}

export default function SaveToCabinetDialog({
  open, onOpenChange, defaultTitle, initialWellId, calcId, buildPayload, onSaved,
}: Props) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fields, setFields] = useState<Field[]>([]);
  const [pads, setPads] = useState<Pad[]>([]);
  const [wells, setWells] = useState<Well[]>([]);

  const [fieldId, setFieldId] = useState<string>("");
  const [padId, setPadId] = useState<string>("");
  const [wellId, setWellId] = useState<string>(initialWellId || "");

  const [newField, setNewField] = useState("");
  const [newPad, setNewPad] = useState("");
  const [newWell, setNewWell] = useState("");

  const [title, setTitle] = useState(defaultTitle);

  useEffect(() => { setTitle(defaultTitle); }, [defaultTitle, open]);

  // Initial load
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      setUserId(session.user.id);

      const { data: f } = await supabase.from("fields").select("id, name").order("name");
      const fieldsArr = (f || []) as Field[];
      setFields(fieldsArr);

      // If initialWellId given, resolve full chain
      if (initialWellId) {
        const { data: w } = await supabase.from("wells").select("id, name, well_pad_id").eq("id", initialWellId).maybeSingle();
        if (w) {
          setWellId(w.id);
          const { data: p } = await supabase.from("well_pads").select("id, name, field_id").eq("id", w.well_pad_id).maybeSingle();
          if (p) {
            setPadId(p.id);
            setFieldId(p.field_id);
            const { data: padsList } = await supabase.from("well_pads").select("id, name, field_id").eq("field_id", p.field_id).order("name");
            setPads((padsList || []) as Pad[]);
            const { data: wellsList } = await supabase.from("wells").select("id, name, well_pad_id").eq("well_pad_id", p.id).order("name");
            setWells((wellsList || []) as Well[]);
          }
        }
      } else if (fieldsArr.length === 1) {
        setFieldId(fieldsArr[0].id);
      }
      setLoading(false);
    })();
  }, [open, initialWellId]);

  // Load pads when field changes
  useEffect(() => {
    if (!fieldId) { setPads([]); return; }
    (async () => {
      const { data } = await supabase.from("well_pads").select("id, name, field_id").eq("field_id", fieldId).order("name");
      const arr = (data || []) as Pad[];
      setPads(arr);
      if (!arr.find(p => p.id === padId)) setPadId(arr.length === 1 ? arr[0].id : "");
    })();
  }, [fieldId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load wells when pad changes
  useEffect(() => {
    if (!padId) { setWells([]); return; }
    (async () => {
      const { data } = await supabase.from("wells").select("id, name, well_pad_id").eq("well_pad_id", padId).order("name");
      const arr = (data || []) as Well[];
      setWells(arr);
      if (!arr.find(w => w.id === wellId)) setWellId(arr.length === 1 ? arr[0].id : "");
    })();
  }, [padId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addField = async () => {
    if (!newField.trim() || !userId) return;
    const { data, error } = await supabase.from("fields").insert({ name: newField.trim(), user_id: userId }).select().single();
    if (error || !data) { toast({ title: "Ошибка", description: error?.message, variant: "destructive" }); return; }
    setFields(f => [...f, data as Field].sort((a, b) => a.name.localeCompare(b.name)));
    setFieldId(data.id);
    setNewField("");
  };

  const addPad = async () => {
    if (!newPad.trim() || !userId || !fieldId) return;
    const { data, error } = await supabase.from("well_pads").insert({ name: newPad.trim(), user_id: userId, field_id: fieldId }).select().single();
    if (error || !data) { toast({ title: "Ошибка", description: error?.message, variant: "destructive" }); return; }
    setPads(p => [...p, data as Pad].sort((a, b) => a.name.localeCompare(b.name)));
    setPadId(data.id);
    setNewPad("");
  };

  const addWell = async () => {
    if (!newWell.trim() || !userId || !padId) return;
    const { data, error } = await supabase.from("wells").insert({ name: newWell.trim(), user_id: userId, well_pad_id: padId }).select().single();
    if (error || !data) { toast({ title: "Ошибка", description: error?.message, variant: "destructive" }); return; }
    setWells(w => [...w, data as Well].sort((a, b) => a.name.localeCompare(b.name)));
    setWellId(data.id);
    setNewWell("");
  };

  const handleSave = useCallback(async () => {
    if (!userId) { toast({ title: "Войдите в кабинет", variant: "destructive" }); return; }
    if (!wellId) { toast({ title: "Выберите или создайте скважину", variant: "destructive" }); return; }
    if (!title.trim()) { toast({ title: "Введите название расчёта", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const payload = buildPayload();
      if (calcId) {
        const { error } = await supabase.from("saved_calculations").update({
          title: title.trim(),
          well_id: wellId,
          well_data: payload.well_data as any,
          calc_params: payload.calc_params as any,
          results: payload.results as any,
        } as any).eq("id", calcId).eq("user_id", userId);
        if (error) throw error;
        toast({ title: "Расчёт обновлён в кабинете" });
        onSaved?.(calcId);
      } else {
        const { data, error } = await supabase.from("saved_calculations").insert({
          user_id: userId,
          well_id: wellId,
          module: payload.module,
          title: title.trim(),
          well_data: payload.well_data as any,
          calc_params: payload.calc_params as any,
          results: payload.results as any,
        } as any).select("id").single();
        if (error) throw error;
        toast({ title: "Расчёт сохранён в кабинете" });
        if (data) onSaved?.(data.id);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [userId, wellId, title, calcId, buildPayload, onOpenChange, onSaved, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{calcId ? "Обновить расчёт" : "Сохранить расчёт в кабинет"}</DialogTitle>
          <DialogDescription>Выберите месторождение → куст → скважину или создайте новые</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {/* Field */}
            <div className="space-y-1.5">
              <Label className="text-xs">Месторождение</Label>
              <Select value={fieldId} onValueChange={(v) => { setFieldId(v); setPadId(""); setWellId(""); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Выберите месторождение" /></SelectTrigger>
                <SelectContent>
                  {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Input value={newField} onChange={e => setNewField(e.target.value)} placeholder="+ Новое месторождение" className="h-8 text-xs" onKeyDown={e => e.key === "Enter" && addField()} />
                <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={addField} disabled={!newField.trim()}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>

            {/* Pad */}
            <div className="space-y-1.5">
              <Label className="text-xs">Куст</Label>
              <Select value={padId} onValueChange={(v) => { setPadId(v); setWellId(""); }} disabled={!fieldId}>
                <SelectTrigger className="h-9"><SelectValue placeholder={fieldId ? "Выберите куст" : "Сначала месторождение"} /></SelectTrigger>
                <SelectContent>
                  {pads.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Input value={newPad} onChange={e => setNewPad(e.target.value)} placeholder="+ Новый куст" className="h-8 text-xs" disabled={!fieldId} onKeyDown={e => e.key === "Enter" && addPad()} />
                <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={addPad} disabled={!fieldId || !newPad.trim()}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>

            {/* Well */}
            <div className="space-y-1.5">
              <Label className="text-xs">Скважина</Label>
              <Select value={wellId} onValueChange={setWellId} disabled={!padId}>
                <SelectTrigger className="h-9"><SelectValue placeholder={padId ? "Выберите скважину" : "Сначала куст"} /></SelectTrigger>
                <SelectContent>
                  {wells.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Input value={newWell} onChange={e => setNewWell(e.target.value)} placeholder="+ № скважины" className="h-8 text-xs" disabled={!padId} onKeyDown={e => e.key === "Enter" && addWell()} />
                <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={addWell} disabled={!padId || !newWell.trim()}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-xs">Название расчёта</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="h-9" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving || loading || !wellId || !title.trim()}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {calcId ? "Обновить" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
