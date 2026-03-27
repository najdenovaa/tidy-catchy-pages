import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AnalysisSection from "@/components/AnalysisSection";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";

const defaultWellData: WellData = {
  wellDepth: 0, casingOD: 0, casingWeight: 0, holeSize: 0,
  prevCasingOD: 0, prevCasingWeight: 0, prevCasingDepth: 0,
  shoeJointLength: 0, ratHoleLength: 0,
  casingShoeDepth: 0, topOfCement: 0,
  cementingMethod: "one-stage" as const,
  stageToolDepth: 0, dv2Depth: 0,
};

const defaultDrillingFluid: DrillingFluid = { density: 0, plasticViscosity: 0, yieldPoint: 0 };

export default function AnalysisPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/cementing" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-16 object-cover object-center" />
            <p className="text-base sm:text-xl font-normal tracking-tight text-foreground uppercase">
              Анализ цементирования
            </p>
          </Link>
          <Link
            to="/cementing"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs sm:text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Назад</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-6 w-full">
        <AnalysisSection
          wellData={defaultWellData}
          drillingFluid={defaultDrillingFluid}
          slurries={[]}
          buffers={[]}
          displacementFluids={[]}
          centralizationResults={null}
        />
      </main>
    </div>
  );
}
