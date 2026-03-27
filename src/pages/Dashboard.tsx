import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, LogOut, Plus, Trash2, ChevronRight, FolderOpen, FlaskConical, Droplets, Zap, Copy, Blocks, Cable, Ruler, Cpu } from "lucide-react";
import ChatHistory from "@/components/ChatHistory";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@supabase/supabase-js";

interface Field { id: string; name: string; created_at: string; }
interface WellPad { id: string; field_id: string; name: string; created_at: string; }
interface Well { id: string; well_pad_id: string; name: string; created_at: string; }
interface SavedCalc { id: string; well_id: string; module: string; title: string; created_at: string; well_data: any; calc_params: any; results: any; }

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ email: string; display_name: string | null; user_id: string } | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [pads, setPads] = useState<WellPad[]>([]);
  const [wells, setWells] = useState<Well[]>([]);
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  const [credits, setCredits] = useState<{ used: number; limit: number; freeFollowups: number }>({ used: 0, limit: 6, freeFollowups: 18 });

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedPad, setSelectedPad] = useState<string | null>(null);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);

  const [newFieldName, setNewFieldName] = useState("");
  const [newPadName, setNewPadName] = useState("");
  const [newWellName, setNewWellName] = useState("");

  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      setUser(session.user);

      const { data: p } = await supabase.from("profiles").select("email, display_name, user_id").eq("user_id", session.user.id).single();
      if (p) setProfile(p);

      // Load credits
      const { data: cred } = await supabase.from("user_credits").select("ai_analyses_used, ai_analyses_limit, free_followups_remaining").eq("user_id", session.user.id).single();
      if (cred) setCredits({ used: cred.ai_analyses_used, limit: cred.ai_analyses_limit, freeFollowups: (cred as any).free_followups_remaining ?? 9 });


      await loadFields();
      setLoading(false);
    };
    check();
  }, [navigate]);

  const loadFields = useCallback(async () => {
    const { data } = await supabase.from("fields").select("*").order("name");
    if (data) setFields(data as Field[]);
  }, []);

  const loadPads = useCallback(async (fieldId: string) => {
    const { data } = await supabase.from("well_pads").select("*").eq("field_id", fieldId).order("name");
    if (data) setPads(data as WellPad[]);
  }, []);

  const loadWells = useCallback(async (padId: string) => {
    const { data } = await supabase.from("wells").select("*").eq("well_pad_id", padId).order("name");
    if (data) setWells(data as Well[]);
  }, []);

  const loadCalcs = useCallback(async (wellId: string) => {
    const { data } = await supabase.from("saved_calculations").select("*").eq("well_id", wellId).order("created_at", { ascending: false });
    if (data) setCalcs(data as SavedCalc[]);
  }, []);

  const selectField = (id: string) => {
    setSelectedField(id);
    setSelectedPad(null);
    setSelectedWell(null);
    setPads([]);
    setWells([]);
    setCalcs([]);
    loadPads(id);
  };

  const selectPad = (id: string) => {
    setSelectedPad(id);
    setSelectedWell(null);
    setWells([]);
    setCalcs([]);
    loadWells(id);
  };

  const selectWell = (id: string) => {
    setSelectedWell(id);
    setCalcs([]);
    loadCalcs(id);
  };

  const addField = async () => {
    if (!newFieldName.trim() || !user) return;
    const { error } = await supabase.from("fields").insert({ name: newFieldName.trim(), user_id: user.id });
    if (error) { toast({ title: "Ошибка", description: error.message, variant: "destructive" }); return; }
    setNewFieldName("");
    loadFields();
  };

  const addPad = async () => {
    if (!newPadName.trim() || !user || !selectedField) return;
    const { error } = await supabase.from("well_pads").insert({ name: newPadName.trim(), user_id: user.id, field_id: selectedField });
    if (error) { toast({ title: "Ошибка", description: error.message, variant: "destructive" }); return; }
    setNewPadName("");
    loadPads(selectedField);
  };

  const addWell = async () => {
    if (!newWellName.trim() || !user || !selectedPad) return;
    const { error } = await supabase.from("wells").insert({ name: newWellName.trim(), user_id: user.id, well_pad_id: selectedPad });
    if (error) { toast({ title: "Ошибка", description: error.message, variant: "destructive" }); return; }
    setNewWellName("");
    loadWells(selectedPad);
  };

  const deleteField = async (id: string) => {
    await supabase.from("fields").delete().eq("id", id);
    if (selectedField === id) { setSelectedField(null); setPads([]); setWells([]); setCalcs([]); }
    loadFields();
  };

  const deletePad = async (id: string) => {
    await supabase.from("well_pads").delete().eq("id", id);
    if (selectedPad === id) { setSelectedPad(null); setWells([]); setCalcs([]); }
    if (selectedField) loadPads(selectedField);
  };

  const deleteWell = async (id: string) => {
    await supabase.from("wells").delete().eq("id", id);
    if (selectedWell === id) { setSelectedWell(null); setCalcs([]); }
    if (selectedPad) loadWells(selectedPad);
  };

  const deleteCalc = async (id: string) => {
    await supabase.from("saved_calculations").delete().eq("id", id);
    if (selectedWell) loadCalcs(selectedWell);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };


  const copyId = () => {
    if (profile?.user_id) {
      navigator.clipboard.writeText(profile.user_id);
      toast({ title: "ID скопирован" });
    }
  };

  const moduleIcon = (m: string) => {
    if (m === "cementing") return <FlaskConical className="w-4 h-4 text-primary" />;
    if (m === "cement-plug") return <Blocks className="w-4 h-4 text-orange-500" />;
    if (m === "drilling-fluids") return <Droplets className="w-4 h-4 text-blue-500" />;
    return <Zap className="w-4 h-4 text-yellow-500" />;
  };

  const moduleLabel = (m: string) => {
    if (m === "cementing") return "Цементирование";
    if (m === "cement-plug") return "Цементный мост";
    if (m === "drilling-fluids") return "Буровые растворы";
    return "ГРП";
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const cementingLink = selectedWell ? `/cementing/program?from=dashboard&well=${selectedWell}` : "/cementing/program?from=dashboard";
  const cementPlugLink = selectedWell ? `/cementing/plugs?from=dashboard&well=${selectedWell}` : "/cementing/plugs?from=dashboard";

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Загрузка...</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Личный кабинет</h1>
          <div className="flex items-center gap-3">
            <Link to="/"><Button variant="ghost" size="sm"><Home className="w-4 h-4 mr-1" /> Главная</Button></Link>
            <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="w-4 h-4 mr-1" /> Выйти</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Profile info */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Никнейм (email)</p>
              <p className="font-medium text-foreground">{profile?.email || user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ваш ID</p>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{profile?.user_id?.slice(0, 8)}...</code>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={copyId}>
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Modules */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm text-muted-foreground">Модули</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link to={cementingLink}><Button variant="outline" size="sm"><FlaskConical className="w-4 h-4 mr-1" /> Программа цементирования</Button></Link>
            <Link to={cementPlugLink}><Button variant="outline" size="sm"><Blocks className="w-4 h-4 mr-1" /> Цементные мосты</Button></Link>
            <Link to="/cementing/analysis"><Button variant="outline" size="sm"><Cpu className="w-4 h-4 mr-1" /> Анализ цементирования</Button></Link>
            <Link to="/coiled-tubing"><Button variant="outline" size="sm"><Cable className="w-4 h-4 mr-1" /> ГНКТ</Button></Link>
            <Button variant="outline" size="sm" disabled><Droplets className="w-4 h-4 mr-1" /> Буровые растворы (скоро)</Button>
            <Button variant="outline" size="sm" disabled><Zap className="w-4 h-4 mr-1" /> ГРП (скоро)</Button>
            <Button variant="outline" size="sm" disabled><Ruler className="w-4 h-4 mr-1" /> Проектирование (скоро)</Button>
            {!selectedWell && <p className="text-xs text-muted-foreground">Чтобы сохранить расчёт в нужную папку, выберите скважину ниже</p>}
          </CardContent>
        </Card>


        {/* Hierarchy browser */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Fields */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Месторождения</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                <Input placeholder="Название" value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && addField()} />
                <Button size="sm" className="h-8 px-2" onClick={addField}><Plus className="w-3 h-3" /></Button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {fields.map(f => (
                  <div key={f.id} className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${selectedField === f.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} onClick={() => selectField(f.id)}>
                    <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" /> {f.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); deleteField(f.id); }} className="text-destructive/50 hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pads */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Кусты</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {selectedField ? (
                <>
                  <div className="flex gap-1">
                    <Input placeholder="Название куста" value={newPadName} onChange={(e) => setNewPadName(e.target.value)} className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && addPad()} />
                    <Button size="sm" className="h-8 px-2" onClick={addPad}><Plus className="w-3 h-3" /></Button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {pads.map(p => (
                      <div key={p.id} className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${selectedPad === p.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} onClick={() => selectPad(p.id)}>
                        <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" /> {p.name}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); deletePad(p.id); }} className="text-destructive/50 hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="text-xs text-muted-foreground">Выберите месторождение</p>}
            </CardContent>
          </Card>

          {/* Wells */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Скважины</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {selectedPad ? (
                <>
                  <div className="flex gap-1">
                    <Input placeholder="№ скважины" value={newWellName} onChange={(e) => setNewWellName(e.target.value)} className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && addWell()} />
                    <Button size="sm" className="h-8 px-2" onClick={addWell}><Plus className="w-3 h-3" /></Button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {wells.map(w => (
                      <div key={w.id} className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${selectedWell === w.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} onClick={() => selectWell(w.id)}>
                        <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" /> {w.name}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); deleteWell(w.id); }} className="text-destructive/50 hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="text-xs text-muted-foreground">Выберите куст</p>}
            </CardContent>
          </Card>

          {/* Calculations */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Расчёты</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {selectedWell ? (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {calcs.length === 0 && <p className="text-xs text-muted-foreground">Нет сохранённых расчётов</p>}
                  {calcs.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-muted group">
                      <Link to={
                        c.module === "cement-plug"
                          ? `/cementing/plugs?from=dashboard&well=${selectedWell}&calc=${c.id}`
                          : `/cementing/program?from=dashboard&well=${selectedWell}&calc=${c.id}`
                      } className="flex items-center gap-1.5 flex-1 min-w-0">
                        {moduleIcon(c.module)}
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.title}</p>
                          <p className="text-[10px] text-muted-foreground">{moduleLabel(c.module)} · {formatDate(c.created_at)}</p>
                        </div>
                      </Link>
                      <button onClick={() => deleteCalc(c.id)} className="text-destructive/50 hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">Выберите скважину</p>}
            </CardContent>
          </Card>
        </div>

        {/* Chat History */}
        <div className="mt-6">
          <ChatHistory />
        </div>
      </main>
    </div>
  );
}
