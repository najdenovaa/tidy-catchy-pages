import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Home, LayoutDashboard, LogOut, Send } from "lucide-react";
import AnalysisSection from "@/components/AnalysisSection";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import { supabase } from "@/integrations/supabase/client";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";

const defaultWellData: WellData = {
  wellDepthMD: 0, wellDepthTVD: 0, casingDepthMD: 0, holeDiameter: 0,
  casingOD: 0, casingWall: 0, prevCasingDepth: 0, prevCasingID: 0,
  prevCasingOD: 0, ckodDepth: 0, cementRiseHeight: 0, cavernCoeff: 1.1,
  bottomTempStatic: 0, bottomTempCirc: 0, trajectory: [],
};

const defaultDrillingFluid: DrillingFluid = {
  name: "", density: 0,
  rheology: { pv: 0, yp: 0 },
  fluidLoss: 0,
};

export default function AnalysisPage() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

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
          <div className="flex items-center gap-3">
            <Link to="/cementing" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <ArrowLeft className="w-4 h-4" /> <span>Назад</span>
            </Link>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <Home className="w-4 h-4" /> <span>Главная</span>
            </Link>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                  <LayoutDashboard className="w-4 h-4" /> <span>Кабинет</span>
                </Link>
                <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                  <Send className="w-4 h-4" /> <span>Поддержка</span>
                </a>
                <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs">
                  <LogOut className="w-4 h-4" /> <span>Выйти</span>
                </button>
              </>
            ) : (
              <Link to="/auth" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <LogOut className="w-4 h-4" /> <span>Войти</span>
              </Link>
            )}
          </div>
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
