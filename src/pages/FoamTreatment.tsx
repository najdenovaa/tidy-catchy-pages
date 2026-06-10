import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import FoamTreatmentSection from "@/components/FoamTreatmentSection";

export default function FoamTreatment() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> На главную
          </Link>
          <h1 className="text-base sm:text-lg font-semibold text-foreground">
            Пенообработка призабойной зоны пласта (ОПЗ)
          </h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">КРС · Интенсификация добычи</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <p className="text-sm text-muted-foreground mb-5 max-w-3xl">
          Расчёт операции пенообработки ПЗП: подбор рецептуры (ПАВ, кислоты, растворители, СГПС, азотный лифт),
          расчёт объёмов и давлений с учётом сжимаемости N₂, циклограмма закачки-выдержки-стравливания и прогноз
          снижения скина с приростом дебита по формуле Дюпюи.
        </p>
        <FoamTreatmentSection />
      </main>

      <footer className="border-t border-border bg-card mt-10">
        <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-muted-foreground text-center">
          Расчёты носят информационный характер. Соответствует требованиям ФЗ-152.{" "}
          <Link to="/terms" className="hover:text-foreground transition-colors underline">
            Пользовательское соглашение
          </Link>
        </div>
      </footer>
    </div>
  );
}
