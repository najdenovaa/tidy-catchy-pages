import { Link } from "react-router-dom";
import { FlaskConical, Shield, Cpu, Home, ArrowLeft } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";

const subModules = [
  {
    title: "Составление программы цементирования",
    description: "Расчёт обсадных колонн, гидравлика, объёмы, материалы, графики",
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
    description: "Подробный AI-анализ качества цементирования по документам",
    icon: Brain,
    to: "/cementing/analysis",
  },
];

export default function CementingHub() {
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
          <Link
            to="/"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Назад</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto px-4 py-10 sm:py-16 w-full">
        <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-8 text-center">
          Выберите раздел
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
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
      </main>
    </div>
  );
}
