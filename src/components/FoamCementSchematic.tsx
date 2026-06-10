import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  baseSlurryRateLps: number;       // подача базовой суспензии, л/с
  n2RateStdM3Min: number;          // расход N₂ (стд), м³/мин
  surfacePressureMPa: number;      // давление на устье, МПа
  backPressureMPa: number;         // обратное давление, МПа
  baseSlurryVolumeM3: number;
  n2VolumeStdM3: number;
  baseDensity: number;             // г/см³
  foamDensitySurface: number;
  targetFQ: number;                // %
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export default function FoamCementSchematic(p: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">🛠 Схема обвязки пеноцементирования</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <svg
            viewBox="0 0 900 380"
            className="w-full min-w-[760px] h-auto"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--primary))" />
              </marker>
              <linearGradient id="cemGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#9aa0a6" />
                <stop offset="1" stopColor="#5b6066" />
              </linearGradient>
              <linearGradient id="n2Grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#a5d8ff" />
                <stop offset="1" stopColor="#4dabf7" />
              </linearGradient>
              <linearGradient id="foamGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#e7f5ff" />
                <stop offset="1" stopColor="#bac8d3" />
              </linearGradient>
            </defs>

            {/* === TOP LINE: Cement train === */}
            {/* Bulk silo */}
            <g>
              <rect x="20" y="60" width="90" height="80" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <path d="M20,60 L65,30 L110,60 Z" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
              <text x="65" y="105" textAnchor="middle" fontSize="11" fill="hsl(var(--foreground))">Бункер</text>
              <text x="65" y="120" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">цемент</text>
            </g>

            {/* Mixer */}
            <g>
              <rect x="160" y="70" width="110" height="70" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <circle cx="215" cy="105" r="22" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
              <line x1="200" y1="105" x2="230" y2="105" stroke="hsl(var(--primary))" strokeWidth="2" />
              <line x1="215" y1="90" x2="215" y2="120" stroke="hsl(var(--primary))" strokeWidth="2" />
              <text x="215" y="155" textAnchor="middle" fontSize="11" fill="hsl(var(--foreground))">Смеситель</text>
            </g>

            {/* Cement pump unit */}
            <g>
              <rect x="320" y="70" width="120" height="70" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <text x="380" y="100" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">ЦА-320</text>
              <text x="380" y="118" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{fmt(p.baseSlurryRateLps, 1)} л/с</text>
              <text x="380" y="132" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">ρ={fmt(p.baseDensity, 2)} г/см³</text>
            </g>

            {/* Foam generator */}
            <g>
              <rect x="540" y="120" width="130" height="80" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />
              <circle cx="580" cy="160" r="6" fill="url(#foamGrad)" />
              <circle cx="595" cy="150" r="5" fill="url(#foamGrad)" />
              <circle cx="610" cy="165" r="7" fill="url(#foamGrad)" />
              <circle cx="625" cy="155" r="5" fill="url(#foamGrad)" />
              <circle cx="640" cy="170" r="6" fill="url(#foamGrad)" />
              <text x="605" y="115" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">Пеногенератор</text>
              <text x="605" y="220" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">FQ = {fmt(p.targetFQ, 0)}%, ρ={fmt(p.foamDensitySurface, 2)}</text>
            </g>

            {/* Wellhead */}
            <g>
              <rect x="760" y="100" width="120" height="220" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <rect x="790" y="100" width="60" height="20" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
              <rect x="800" y="120" width="40" height="200" fill="url(#cemGrad)" opacity="0.6" />
              <line x1="800" y1="120" x2="800" y2="320" stroke="hsl(var(--border))" />
              <line x1="840" y1="120" x2="840" y2="320" stroke="hsl(var(--border))" />
              <text x="820" y="345" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">Устье / Затрубье</text>
              <text x="820" y="360" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">P уст. = {fmt(p.surfacePressureMPa, 2)} МПа</text>
            </g>

            {/* === BOTTOM LINE: N₂ train === */}
            <g>
              <rect x="20" y="240" width="90" height="80" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <rect x="35" y="255" width="60" height="55" rx="3" fill="url(#n2Grad)" opacity="0.4" stroke="hsl(var(--border))" />
              <text x="65" y="290" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">N₂</text>
              <text x="65" y="335" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">криоген</text>
            </g>
            <g>
              <rect x="160" y="250" width="110" height="70" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <path d="M180,285 Q195,265 215,285 T 250,285" fill="none" stroke="hsl(280, 60%, 55%)" strokeWidth="2" />
              <text x="215" y="310" textAnchor="middle" fontSize="11" fill="hsl(var(--foreground))">Испаритель</text>
            </g>
            <g>
              <rect x="320" y="250" width="120" height="70" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
              <text x="380" y="278" textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">Насос N₂</text>
              <text x="380" y="295" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{fmt(p.n2RateStdM3Min, 2)} м³/мин (ст.)</text>
              <text x="380" y="310" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">Σ {fmt(p.n2VolumeStdM3, 0)} м³</text>
            </g>

            {/* === FLOW LINES === */}
            {/* Cement pump → foam generator (top down to middle) */}
            <line x1="440" y1="105" x2="540" y2="155" stroke="hsl(var(--primary))" strokeWidth="3" markerEnd="url(#arr)" />
            {/* N₂ pump → foam generator (bottom up to middle) */}
            <line x1="440" y1="285" x2="540" y2="180" stroke="hsl(280, 60%, 55%)" strokeWidth="3" markerEnd="url(#arr)" />
            {/* Silo → mixer */}
            <line x1="110" y1="100" x2="160" y2="105" stroke="hsl(var(--primary))" strokeWidth="2" markerEnd="url(#arr)" />
            {/* Mixer → pump */}
            <line x1="270" y1="105" x2="320" y2="105" stroke="hsl(var(--primary))" strokeWidth="2" markerEnd="url(#arr)" />
            {/* N₂ tank → evaporator → pump */}
            <line x1="110" y1="285" x2="160" y2="285" stroke="hsl(280, 60%, 55%)" strokeWidth="2" markerEnd="url(#arr)" />
            <line x1="270" y1="285" x2="320" y2="285" stroke="hsl(280, 60%, 55%)" strokeWidth="2" markerEnd="url(#arr)" />
            {/* Foam generator → wellhead */}
            <line x1="670" y1="160" x2="760" y2="160" stroke="hsl(var(--primary))" strokeWidth="4" markerEnd="url(#arr)" />
            <text x="715" y="150" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">пеноцемент</text>

            {/* Back-pressure label */}
            <text x="820" y="90" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">P обр. = {fmt(p.backPressureMPa, 2)} МПа</text>
          </svg>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          Базовая суспензия из ЦА смешивается с N₂ в пеногенераторе. Качество пены FQ = V<sub>газа</sub> / V<sub>пены</sub>.
          Обратное давление на устье удерживает пену от расширения и стабилизирует FQ.
        </div>
      </CardContent>
    </Card>
  );
}
