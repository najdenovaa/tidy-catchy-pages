import { useState } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Сессия входа не создана");

      // Check if user is admin
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "admin")
        .limit(1)
        .abortSignal(AbortSignal.timeout(10_000));

      if (rolesError) {
        toast({ title: "Сервис недоступен", description: "Не удалось проверить права администратора. Повторите вход позже.", variant: "destructive" });
        return;
      }

      if (!roles || roles.length === 0) {
        await supabase.auth.signOut();
        toast({ title: "Доступ запрещён", description: "У вас нет прав администратора", variant: "destructive" });
        return;
      }

      navigate("/admin");
    } catch (err) {
      const description = isAuthRetryableFetchError(err)
        ? "Сервис входа временно недоступен. Повторите попытку позже."
        : err instanceof Error ? err.message : "Не удалось войти";
      toast({ title: "Ошибка входа", description, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Вход для администратора</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              <LogIn className="w-4 h-4 mr-2" />
              {loading ? "Вход..." : "Войти"}
            </Button>
          </form>
          <div className="mt-4 space-y-3 text-center">
            <Link to="/auth?mode=signup" className="block text-sm text-primary hover:underline">
              Создать аккаунт в новой базе
            </Link>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Home className="w-3 h-3" /> На главную
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
