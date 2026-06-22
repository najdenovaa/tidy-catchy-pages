import { Link, useNavigate } from "react-router-dom";
import { FlaskConical, Shield, Cpu, Home, ArrowLeft, LayoutDashboard, LogOut, Send } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import { supabase } from "@/integrations/supabase/client";
import WellBatchExportCard from "@/components/WellBatchExportCard";

const subModules = [
  {
    title: "Составление программы цементирования",
    description: "Расчёт обсадных колонн, гидравлика, объёмы, материалы, графики + симулятор ОЗЦ",
    icon: FlaskConical,
    to: "/cementing/program",
  },
  {
    title: "Цементные мосты",
    description: "Расчёт установки цементных мостов, давления, визуализация",
    icon: Shield,
    to: "/cementing/plugs",
  },
  {
    title: "Анализ цементирования",
    description: "Подробный анализ качества цементирования по документам",
    icon: Cpu,
    to: "/cementing/analysis",
  },
];

export default function CementingHub() {
  const navigate = useNavigate();
  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-16 object-cover object-center" />
            <p className="text-base sm:text-xl font-normal tracking-tight text-foreground uppercase">
              Цементирование скважин
            </p>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <ArrowLeft className="w-4 h-4" /> <span>Назад</span>
            </Link>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <Home className="w-4 h-4" /> <span>Главная</span>
            </Link>
            <Link to="/dashboard" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <LayoutDashboard className="w-4 h-4" /> <span>Кабинет</span>
            </Link>
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <Send className="w-4 h-4" /> <span>Поддержка</span>
            </a>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs">
              <LogOut className="w-4 h-4" /> <span>Выйти</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-10 sm:py-16 w-full space-y-8">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-8 text-center">
            Выберите раздел
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {subModules.map((m) => (
              <Link
                key={m.to}
                to={m.to}
                className="group rounded-xl border border-border bg-card p-6 sm:p-8 flex flex-col items-center text-center gap-4 hover:border-primary/50 hover:shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <m.icon className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-foreground">{m.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{m.description}</p>
              </Link>
            ))}
          </div>
        </div>

        <WellBatchExportCard />
      </main>
    </div>
  );
}
