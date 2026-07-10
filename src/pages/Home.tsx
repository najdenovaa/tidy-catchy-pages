import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Send, FlaskConical, Droplets, Zap, Shield, UserCircle, Cable, Ruler, Wrench } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import geoladLogo from "@/assets/geolad.jpg.asset.json";
import nefteservisLogo from "@/assets/nefteservis-logo.png.asset.json";
import drillingBanner from "@/assets/drilling-banner.jpg";
import engineeringGraphBg from "@/assets/engineering-graph-bg.mp4";
import { supabase } from "@/integrations/supabase/client";

const modules = [
  { title: "Цементирование скважин", description: "Программа цементирования, цементные мосты, анализ качества", icon: FlaskConical, to: "/cementing", available: true },
  { title: "Буровые растворы", description: "Подбор и расчёт буровых растворов", icon: Droplets, to: "/drilling-fluids", available: false },
  { title: "ГНКТ (Coiled Tubing)", description: "Силы, пределы, гидравлика, ресурс усталости", icon: Cable, to: "/coiled-tubing", available: true },
  { title: "Интенсификация добычи (ОПЗ)", description: "Кислотные, пенные, азотные и комбинированные обработки: подбор метода, расчёт, план, прогноз", icon: FlaskConical, to: "/stimulation", available: true },
  { title: "ГРП", description: "Проектирование и расчёт гидроразрыва пласта", icon: Zap, to: "/fracturing", available: false },
  { title: "Проектирование скважины", description: "Проектирование конструкции и траектории скважины", icon: Ruler, to: "/well-design", available: false },
  { title: "КРС — Капитальный ремонт скважин", description: "Пакеры, затяжки, прихваты, ловильные работы, нагрузки на подъёмник", icon: Wrench, to: "/workover", available: true },
];

export default function Home() {
  const [visitCount, setVisitCount] = useState(0);
  const [calcCount, setCalcCount] = useState(0);

  const fetchStats = useCallback(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-stats`, {
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    })
      .then(r => r.json())
      .then(data => {
        setVisitCount(data.visits ?? 0);
        setCalcCount(data.calculations ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "visit", module: "home", page_url: "/" },
    }).then(() => fetchStats()).catch(() => {});
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="relative min-h-screen bg-background flex flex-col overflow-hidden">
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-20"
        autoPlay muted loop playsInline
      >
        <source src={engineeringGraphBg} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-background/75" />
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-4 py-1 sm:py-2 flex items-center justify-between">
            <Link to="/" className="flex flex-col items-start gap-0">
              <div className="flex items-center gap-3 -mt-1 sm:-mt-2">
                <img src={deallsoftLogo} alt="DeAllsoft" className="h-20 sm:h-28 w-auto object-contain" />
                <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase">
                  Инженерные расчёты
                </p>
              </div>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] sm:text-xs text-muted-foreground italic mb-0.5">при поддержке</span>
                <div className="flex items-start gap-3">
                  <img src={geoladLogo.url} alt="Геолад" className="h-9 sm:h-12 w-auto object-contain" />
                  <img src={nefteservisLogo.url} alt="Нефтесервис" className="h-4 sm:h-6 w-auto object-contain" />
                </div>
              </div>
            </Link>
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-3">
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <Send className="w-4 h-4" /><span>Поддержка</span>
              </a>
              <Link to="/auth" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <UserCircle className="w-4 h-4" /><span>Кабинет</span>
              </Link>
              <Link to="/admin-login" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm">
                <Shield className="w-4 h-4" /><span>Админ</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-5xl mx-auto px-4 py-10 sm:py-16 w-full">
          <div className="flex items-center justify-center gap-6 text-[11px] text-muted-foreground/70 mb-6">
            <span>👁 Посещений: <span className="font-semibold text-muted-foreground">{visitCount}</span></span>
            <span>🧮 Расчётов: <span className="font-semibold text-muted-foreground">{calcCount}</span></span>
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-8 text-center">
            Выберите модуль
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {modules.map((m) =>
              m.available ? (
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
              ) : (
                <div
                  key={m.to}
                  className="rounded-xl border border-border bg-card/50 p-6 sm:p-8 flex flex-col items-center text-center gap-4 opacity-60 cursor-not-allowed"
                >
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                    <m.icon className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-muted-foreground">{m.title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{m.description}</p>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 bg-muted px-2 py-0.5 rounded">
                    В разработке
                  </span>
                </div>
              )
            )}
          </div>
        </main>

        <footer className="w-full">
          <div className="bg-card border-t border-border py-6">
            <div className="max-w-5xl mx-auto px-4 text-center space-y-3">
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <a href="https://t.me/deallbiz_bot" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">🧪 Бот химической продукции DeAll</a>
                <span className="text-border">|</span>
                <a href="https://t.me/deallbiz" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">📢 Новостной канал DeAll</a>
              </div>
              <div className="pt-2 border-t border-border/50">
                <Link to="/terms" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                  Пользовательское соглашение и Политика конфиденциальности
                </Link>
              </div>
            </div>
          </div>
          <img src={drillingBanner} alt="Буровые установки" className="w-full h-20 sm:h-28 object-cover object-center opacity-30" />
        </footer>
      </div>
    </div>
  );
}
