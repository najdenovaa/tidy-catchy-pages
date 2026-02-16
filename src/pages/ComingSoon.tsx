import { useParams, Link } from "react-router-dom";
import { Send, ArrowLeft } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";

const titles: Record<string, string> = {
  "drilling-fluids": "Буровые растворы",
  fracturing: "Гидроразрыв пласта",
};

export default function ComingSoon() {
  const { module } = useParams<{ module: string }>();
  const title = titles[module || ""] || "Модуль";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-14 sm:h-24 object-cover object-center" />
            <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase">
              Инженерные расчёты
            </p>
          </div>
          <a
            href="https://t.me/deallbiz_support"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm"
          >
            <Send className="w-4 h-4" />
            <span>Поддержка</span>
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-md">
          Извините, мы работаем над данным программным обеспечением. По вопросам обращайтесь в{" "}
          <a
            href="https://t.me/deallbiz_support"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            Поддержку
          </a>
          .
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-4"
        >
          <ArrowLeft className="w-4 h-4" />
          На главную
        </Link>
      </main>
    </div>
  );
}
