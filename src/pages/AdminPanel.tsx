import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, LogOut, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CalcLog {
  id: string;
  created_at: string;
  module: string;
  well_data: any;
  calc_params: any;
  ip_address: string | null;
  user_agent: string | null;
  page_url: string | null;
}

interface VisitLog {
  id: string;
  created_at: string;
  module: string;
  ip_address: string | null;
  user_agent: string | null;
  page_url: string | null;
}

export default function AdminPanel() {
  const [calcLogs, setCalcLogs] = useState<CalcLog[]>([]);
  const [visitLogs, setVisitLogs] = useState<VisitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/admin-login");
        return;
      }
      // Check admin role
      const { data: roles } = await supabase.from("user_roles").select("role").limit(1);
      if (!roles || roles.length === 0) {
        await supabase.auth.signOut();
        navigate("/admin-login");
        return;
      }
      setAuthenticated(true);
      fetchData();
    };
    checkAuth();
  }, [navigate]);

  const fetchData = async () => {
    setLoading(true);
    const [calcRes, visitRes] = await Promise.all([
      supabase.from("calculation_logs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("visit_logs").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (calcRes.data) setCalcLogs(calcRes.data as CalcLog[]);
    if (visitRes.data) setVisitLogs(visitRes.data as VisitLog[]);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const getWellSummary = (wd: any) => {
    if (!wd) return "—";
    const parts: string[] = [];
    if (wd.wellDepthMD) parts.push(`MD:${wd.wellDepthMD}`);
    if (wd.casingOD) parts.push(`ОК:${wd.casingOD}`);
    if (wd.holeDiameter) parts.push(`Dскв:${wd.holeDiameter}`);
    return parts.length > 0 ? parts.join(", ") : "—";
  };

  if (!authenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Панель администратора</h1>
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm"><Home className="w-4 h-4 mr-1" /> Главная</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1" /> Выйти
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-muted-foreground">Всего расчётов</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold">{calcLogs.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-muted-foreground">Всего посещений</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold">{visitLogs.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-muted-foreground">Уникальных IP</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold">
                {new Set([...calcLogs, ...visitLogs].map(l => l.ip_address).filter(Boolean)).size}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end mb-4">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Обновить
          </Button>
        </div>

        <Tabs defaultValue="calculations">
          <TabsList>
            <TabsTrigger value="calculations">Расчёты ({calcLogs.length})</TabsTrigger>
            <TabsTrigger value="visits">Посещения ({visitLogs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="calculations">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата/время</TableHead>
                      <TableHead>Модуль</TableHead>
                      <TableHead>Данные скважины</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>User-Agent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calcLogs.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Нет данных</TableCell></TableRow>
                    ) : calcLogs.map(log => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                        <TableCell className="text-xs">{log.module}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{getWellSummary(log.well_data)}</TableCell>
                        <TableCell className="text-xs font-mono">{log.ip_address || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visits">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата/время</TableHead>
                      <TableHead>Модуль</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>User-Agent</TableHead>
                      <TableHead>URL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitLogs.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Нет данных</TableCell></TableRow>
                    ) : visitLogs.map(log => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                        <TableCell className="text-xs">{log.module}</TableCell>
                        <TableCell className="text-xs font-mono">{log.ip_address || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{log.user_agent || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{log.page_url || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
