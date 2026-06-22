import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Home, LayoutDashboard, LogOut, Send } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import WOCAnimation from "@/components/WOCAnimation";
import { useSharedWell } from "@/lib/shared-well-store";

export default function WOCSimulator() {
  const navigate = useNavigate();
  const [shared] = useSharedWell();
  const [bhct, setBhct] = useState<number>(shared.reservoirTempC ?? 60);
  const [bhst, setBhst] = useState<number>((shared.reservoirTempC ?? 60) + 15);
  const [slurryDensity, setSlurryDensity] = useState<number>(1900);
  const [tvd, setTvd] = useState<number>(shared.wellDepthTVD ?? 2500);
  const [cls, setCls] = useState<"G" | "H">("G");
  const [totalHours, setTotalHours] = useState<number>(48);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/cementing" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-14 object-cover object-center" />
            <p className="text-base sm:text-lg font-normal tracking-tight text-foreground uppercase">
              Симулятор ОЗЦ
            </p>
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <Link to="/cementing" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Назад
            </Link>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Home className="w-4 h-4" /> Главная
            </Link>
            <Link to="/dashboard" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <LayoutDashboard className="w-4 h-4" /> Кабинет
            </Link>
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Send className="w-4 h-4" /> Поддержка
            </a>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive">
              <LogOut className="w-4 h-4" /> Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-4 py-6 w-full space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Параметры скважины и раствора</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="BHCT, °C" value={bhct} onChange={setBhct} />
            <Field label="BHST, °C" value={bhst} onChange={setBhst} />
            <Field label="ρ раствора, кг/м³" value={slurryDensity} onChange={setSlurryDensity} />
            <Field label="TVD, м" value={tvd} onChange={setTvd} />
            <div>
              <Label className="text-xs">Класс цемента</Label>
              <select value={cls} onChange={e => setCls(e.target.value as "G" | "H")}
                className="w-full px-2 py-1.5 rounded bg-background border border-input text-sm">
                <option value="G">Class G</option>
                <option value="H">Class H</option>
              </select>
            </div>
            <Field label="Окно, ч" value={totalHours} onChange={setTotalHours} />
          </CardContent>
        </Card>

        <WOCAnimation
          bhct={bhct}
          bhst={bhst}
          slurryDensity={slurryDensity}
          tvd={tvd}
          cementClass={cls}
          totalHours={totalHours}
        />
      </main>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={e => onChange(+e.target.value || 0)} className="h-9" />
    </div>
  );
}
