import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, LogOut, RefreshCw, Search, Users, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CalcLog {
  id: string; created_at: string; module: string; well_data: any; calc_params: any;
  ip_address: string | null; user_agent: string | null; page_url: string | null; location: string | null;
}
interface VisitLog {
  id: string; created_at: string; module: string;
  ip_address: string | null; user_agent: string | null; page_url: string | null; location: string | null;
}
interface Profile {
  user_id: string; email: string; display_name: string | null; created_at: string;
}
interface SavedCalc {
  id: string; user_id: string; module: string; title: string; created_at: string; well_data: any; calc_params: any; results: any;
  well_id: string;
}

export default function AdminPanel() {
  const [calcLogs, setCalcLogs] = useState<CalcLog[]>([]);
  const [visitLogs, setVisitLogs] = useState<VisitLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [searchUserId, setSearchUserId] = useState("");
  const [userCalcs, setUserCalcs] = useState<SavedCalc[]>([]);
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/admin-login"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").limit(1);
      if (!roles || roles.length === 0) { await supabase.auth.signOut(); navigate("/admin-login"); return; }
      setAuthenticated(true);
      fetchData();
    };
    checkAuth();
  }, [navigate]);

  const fetchData = async () => {
    setLoading(true);
    const [calcRes, visitRes, profilesRes] = await Promise.all([
      supabase.from("calculation_logs").select("*").order("created_at", { ascending: false }).limit(10000),
      supabase.from("visit_logs").select("*").order("created_at", { ascending: false }).limit(10000),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    ]);
    if (calcRes.data) setCalcLogs(calcRes.data as CalcLog[]);
    if (visitRes.data) setVisitLogs(visitRes.data as VisitLog[]);
    if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  const formatDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const moduleLabel = (m: string) => {
    if (m === "cementing") return "Цементирование";
    if (m === "cement-plug") return "Цем. мосты";
    if (m === "coiled-tubing") return "ГНКТ";
    return m;
  };

  const getWellSummary = (wd: any, module?: string) => {
    if (!wd) return "—";
    const parts: string[] = [];
    if (module === "coiled-tubing") {
      // ГНКТ: well_data содержит {ct, well, fluid, ...}
      const w = wd.well;
      if (w?.md) parts.push(`MD:${w.md}`);
      if (w?.tvd) parts.push(`TVD:${w.tvd}`);
      const ct = wd.ct;
      if (ct?.od) parts.push(`CT OD:${ct.od}"`);
      return parts.length > 0 ? parts.join(", ") : "—";
    }
    if (wd.wellDepthMD) parts.push(`MD:${wd.wellDepthMD}`);
    if (wd.casingOD) parts.push(`ОК:${wd.casingOD}`);
    if (wd.holeDiameter) parts.push(`Dскв:${wd.holeDiameter}`);
    return parts.length > 0 ? parts.join(", ") : "—";
  };

  const lookupUser = async () => {
    const q = searchUserId.trim();
    if (!q) return;
    // Search by ID or email
    let profile: Profile | null = null;
    if (q.includes("@")) {
      const { data } = await supabase.from("profiles").select("*").eq("email", q).single();
      if (data) profile = data as Profile;
    } else {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", q).single();
      if (data) profile = data as Profile;
    }
    if (!profile) { toast({ title: "Пользователь не найден", variant: "destructive" }); return; }
    setViewingUser(profile);
    const { data: calcs } = await supabase.from("saved_calculations").select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false });
    setUserCalcs((calcs || []) as SavedCalc[]);
  };

  const homeVisits = visitLogs.filter(v => v.page_url === "/" || v.page_url === "" || v.module === "home" || v.page_url?.endsWith("/"));
  const cementingVisits = visitLogs.filter(v => v.page_url?.includes("/cementing") || v.module === "cementing");
  const cementingCalcs = calcLogs.filter(l => l.module === "cementing");
  const cementPlugVisits = visitLogs.filter(v => v.page_url?.includes("/cement-plug") || v.module === "cement-plug");
  const cementPlugCalcs = calcLogs.filter(l => l.module === "cement-plug");
  const ctVisits = visitLogs.filter(v => v.page_url?.includes("/coiled-tubing") || v.module === "coiled-tubing");
  const ctCalcs = calcLogs.filter(l => l.module === "coiled-tubing");

  if (!authenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Панель администратора</h1>
          <div className="flex items-center gap-3">
            <Link to="/"><Button variant="ghost" size="sm"><Home className="w-4 h-4 mr-1" /> Главная</Button></Link>
            <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="w-4 h-4 mr-1" /> Выйти</Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Всего расчётов</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{calcLogs.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Всего посещений</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{visitLogs.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Пользователей</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{profiles.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Уникальных IP</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{new Set([...calcLogs, ...visitLogs].map(l => l.ip_address).filter(Boolean)).size}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Главная (визиты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{homeVisits.length}</p></CardContent></Card>

          {/* Цементирование */}
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Цементаж (визиты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{cementingVisits.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Цементаж (расчёты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{cementingCalcs.length}</p></CardContent></Card>

          {/* Цем. мосты */}
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Цем. мосты (визиты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{cementPlugVisits.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">Цем. мосты (расчёты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{cementPlugCalcs.length}</p></CardContent></Card>

          {/* ГНКТ */}
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">ГНКТ (визиты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{ctVisits.length}</p></CardContent></Card>
          <Card><CardHeader className="py-3 px-4"><CardTitle className="text-sm text-muted-foreground">ГНКТ (расчёты)</CardTitle></CardHeader><CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{ctCalcs.length}</p></CardContent></Card>
        </div>

        <div className="flex justify-end mb-4">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Обновить
          </Button>
        </div>

        <Tabs defaultValue="calculations">
          <div className="overflow-x-auto pb-2">
            <TabsList className="inline-flex min-w-max flex-nowrap">
              <TabsTrigger value="calculations">Расчёты ({calcLogs.length})</TabsTrigger>
              <TabsTrigger value="visits">Посещения ({visitLogs.length})</TabsTrigger>
              <TabsTrigger value="home-visits">Главная ({homeVisits.length})</TabsTrigger>
              <TabsTrigger value="users">Пользователи ({profiles.length})</TabsTrigger>
              <TabsTrigger value="lookup">Поиск по ID</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="calculations">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Дата/время</TableHead><TableHead>Модуль</TableHead><TableHead>Данные скважины</TableHead>
                  <TableHead>IP</TableHead><TableHead>Регион</TableHead><TableHead>User-Agent</TableHead><TableHead>Ссылка</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {calcLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Нет данных</TableCell></TableRow>
                  ) : calcLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                      <TableCell className="text-xs">{moduleLabel(log.module)}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{getWellSummary(log.well_data, log.module)}</TableCell>
                      <TableCell className="text-xs font-mono">{log.ip_address || "—"}</TableCell>
                      <TableCell className="text-xs">{log.location || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "—"}</TableCell>
                      <TableCell className="text-xs"><Link to={`/admin/calc/${log.id}`} className="text-primary underline hover:text-primary/80">Открыть</Link></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="visits">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Дата/время</TableHead><TableHead>Модуль</TableHead><TableHead>IP</TableHead>
                  <TableHead>Регион</TableHead><TableHead>User-Agent</TableHead><TableHead>URL</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visitLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Нет данных</TableCell></TableRow>
                  ) : visitLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                      <TableCell className="text-xs">{log.module}</TableCell>
                      <TableCell className="text-xs font-mono">{log.ip_address || "—"}</TableCell>
                      <TableCell className="text-xs">{log.location || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{log.page_url || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="home-visits">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Дата/время</TableHead><TableHead>IP</TableHead><TableHead>Регион</TableHead>
                  <TableHead>User-Agent</TableHead><TableHead>URL</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {homeVisits.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Нет данных о посещениях главной</TableCell></TableRow>
                  ) : homeVisits.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                      <TableCell className="text-xs font-mono">{log.ip_address || "—"}</TableCell>
                      <TableCell className="text-xs">{log.location || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "—"}</TableCell>
                      <TableCell className="text-xs">{log.page_url || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="users">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Дата регистрации</TableHead><TableHead>Email</TableHead><TableHead>ID</TableHead><TableHead>Действия</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {profiles.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Нет пользователей</TableCell></TableRow>
                  ) : profiles.map(p => (
                    <TableRow key={p.user_id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(p.created_at)}</TableCell>
                      <TableCell className="text-xs">{p.email}</TableCell>
                      <TableCell className="text-xs font-mono">{p.user_id.slice(0, 8)}...</TableCell>
                      <TableCell className="text-xs">
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setSearchUserId(p.user_id); lookupUser(); setViewingUser(p); supabase.from("saved_calculations").select("*").eq("user_id", p.user_id).order("created_at", { ascending: false }).then(({ data }) => setUserCalcs((data || []) as SavedCalc[])); }}>
                          <Eye className="w-3 h-3 mr-1" /> Просмотр
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="lookup">
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Поиск пользователя по ID или Email</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input placeholder="ID пользователя или email" value={searchUserId} onChange={(e) => setSearchUserId(e.target.value)} className="max-w-md" onKeyDown={(e) => e.key === "Enter" && lookupUser()} />
                  <Button onClick={lookupUser}><Search className="w-4 h-4 mr-1" /> Найти</Button>
                </div>

                {viewingUser && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-border bg-muted/30">
                      <p className="text-sm"><strong>Email:</strong> {viewingUser.email}</p>
                      <p className="text-sm"><strong>ID:</strong> <code className="text-xs font-mono">{viewingUser.user_id}</code></p>
                      <p className="text-sm"><strong>Дата регистрации:</strong> {formatDate(viewingUser.created_at)}</p>
                    </div>

                    <h3 className="font-medium text-sm flex items-center gap-1"><Users className="w-4 h-4" /> Расчёты пользователя ({userCalcs.length})</h3>
                    {userCalcs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">У пользователя нет сохранённых расчётов</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Дата</TableHead><TableHead>Модуль</TableHead><TableHead>Название</TableHead><TableHead>Данные</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {userCalcs.map(c => (
                            <TableRow key={c.id}>
                              <TableCell className="text-xs whitespace-nowrap">{formatDate(c.created_at)}</TableCell>
                              <TableCell className="text-xs">{c.module}</TableCell>
                              <TableCell className="text-xs">{c.title}</TableCell>
                              <TableCell className="text-xs max-w-[300px] truncate">{getWellSummary(c.well_data)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
