import { useState, useEffect, useCallback, useRef } from "react";
import type { WellData, DrillingFluid, BufferFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";

const SESSION_KEY = "cementing_session_v1";

interface SessionData {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
}

const defaultWellData: WellData = {
  wellDepthMD: 0,
  wellDepthTVD: 0,
  casingDepthMD: 0,
  holeDiameter: 0,
  casingOD: 0,
  casingWall: 0,
  prevCasingDepth: 0,
  prevCasingOD: 0,
  prevCasingID: 0,
  ckodDepth: 0,
  cementRiseHeight: 0,
  cavernCoeff: 1.0,
  bottomTempStatic: 0,
  bottomTempCirc: 0,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
};

const defaultDrillingFluid: DrillingFluid = {
  name: "",
  density: 0,
  rheology: { pv: 0, yp: 0 },
  fluidLoss: 0,
};

const defaultSession: SessionData = {
  wellData: defaultWellData,
  drillingFluid: defaultDrillingFluid,
  slurries: [],
  buffers: [],
  displacementFluids: [],
  fractureGradient: 17.7,
  flushTimeMin: 10,
  flushVolumeM3: 0,
};

function loadSession(): SessionData {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return { ...defaultSession, ...JSON.parse(raw) };
  } catch {}
  return defaultSession;
}

function saveSession(data: SessionData) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

export function useCementingSession() {
  const initial = loadSession();

  const [wellData, setWellData] = useState<WellData>(initial.wellData);
  const [drillingFluid, setDrillingFluid] = useState<DrillingFluid>(initial.drillingFluid);
  const [slurries, setSlurries] = useState<SlurryInput[]>(initial.slurries);
  const [buffers, setBuffers] = useState<BufferFluid[]>(initial.buffers);
  const [displacementFluids, setDisplacementFluids] = useState<DisplacementFluid[]>(initial.displacementFluids);
  const [fractureGradient, setFractureGradient] = useState<number>(initial.fractureGradient);
  const [flushTimeMin, setFlushTimeMin] = useState<number>(initial.flushTimeMin);
  const [flushVolumeM3, setFlushVolumeM3] = useState<number>(initial.flushVolumeM3);

  // Debounced save to sessionStorage
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingData = useRef<SessionData>({
    wellData, drillingFluid, slurries, buffers, displacementFluids,
    fractureGradient, flushTimeMin, flushVolumeM3,
  });

  const scheduleSave = useCallback((data: SessionData) => {
    pendingData.current = data;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSession(pendingData.current);
    }, 500);
  }, []);

  useEffect(() => {
    scheduleSave({ wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3 });
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3, scheduleSave]);

  const resetSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setWellData(defaultWellData);
    setDrillingFluid(defaultDrillingFluid);
    setSlurries([]);
    setBuffers([]);
    setDisplacementFluids([]);
    setFractureGradient(17.7);
    setFlushTimeMin(10);
    setFlushVolumeM3(0);
  }, []);

  return {
    wellData, setWellData,
    drillingFluid, setDrillingFluid,
    slurries, setSlurries,
    buffers, setBuffers,
    displacementFluids, setDisplacementFluids,
    fractureGradient, setFractureGradient,
    flushTimeMin, setFlushTimeMin,
    flushVolumeM3, setFlushVolumeM3,
    resetSession,
  };
}
