import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AnalysisSection from "@/components/AnalysisSection";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";

const defaultWellData: WellData = {
  wellDepthMD: 0, wellDepthTVD: 0, casingDepthMD: 0, holeDiameter: 0,
  casingOD: 0, casingWall: 0, prevCasingDepth: 0, prevCasingID: 0,
  prevCasingOD: 0, ckodDepth: 0, cementRiseHeight: 0, cavernCoeff: 1.1,
  bottomTempStatic: 0, bottomTempCirc: 0, trajectory: [],
};

const defaultDrillingFluid: DrillingFluid = {
  name: "", density: 0,
  rheology: { pv: 0, yp: 0, model: "bingham" },
  fluidLoss: 0,
};

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
