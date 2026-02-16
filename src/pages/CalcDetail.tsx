import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Home } from "lucide-react";

export default function CalcDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/admin-login");
        return;
      }
      const { data: roles } = await supabase.from("user_roles").select("role").limit(1);
      if (!roles || roles.length === 0) {
        await supabase.auth.signOut();
        navigate("/admin-login");
        return;
      }
      setAuthenticated(true);
      fetchCalc();
    };
    checkAuth();
  }, [navigate, id]);

  const fetchCalc = async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("calculation_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    setLog(data);
    setLoading(false);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  const renderJson = (label: string, obj: any) => {
    if (!obj) return null;
    return (
      <Card className="mb-4">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">{label}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[500px] whitespace-pre-wrap break-words">
            {JSON.stringify(obj, null, 2)}
          </pre>
        </CardContent>
      </Card>
    );
  };

  if (!authenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Детали расчёта</h1>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Назад
            </Button>
            <Link to="/">
              <Button variant="ghost" size="sm"><Home className="w-4 h-4 mr-1" /> Главная</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <p className="text-muted-foreground text-center py-12">Загрузка...</p>
        ) : !log ? (
          <p className="text-muted-foreground text-center py-12">Расчёт не найден</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="py-2 px-4"><CardTitle className="text-xs text-muted-foreground">Дата</CardTitle></CardHeader>
                <CardContent className="px-4 pb-2"><p className="text-sm font-medium">{formatDate(log.created_at)}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2 px-4"><CardTitle className="text-xs text-muted-foreground">Модуль</CardTitle></CardHeader>
                <CardContent className="px-4 pb-2"><p className="text-sm font-medium">{log.module}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2 px-4"><CardTitle className="text-xs text-muted-foreground">IP</CardTitle></CardHeader>
                <CardContent className="px-4 pb-2"><p className="text-sm font-mono">{log.ip_address || "—"}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2 px-4"><CardTitle className="text-xs text-muted-foreground">User-Agent</CardTitle></CardHeader>
                <CardContent className="px-4 pb-2"><p className="text-xs break-all">{log.user_agent || "—"}</p></CardContent>
              </Card>
            </div>

            {renderJson("Данные скважины (well_data)", log.well_data)}
            {renderJson("Параметры расчёта (calc_params)", log.calc_params)}

            {log.page_url && (
              <Card className="mb-4">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">URL страницы</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <a href={log.page_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">
                    {log.page_url}
                  </a>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
