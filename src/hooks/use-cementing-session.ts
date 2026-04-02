import { useState, useEffect, useCallback, useRef } from "react";
import type { WellData, DrillingFluid, BufferFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";
import {
  defaultCementingSnapshot,
  normalizeCementingSnapshot,
} from "@/lib/cementing-normalizers";

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

const defaultSession: SessionData = {
  ...defaultCementingSnapshot,
};

function loadSession(): SessionData {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return normalizeCementingSnapshot(JSON.parse(raw));
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
    setWellData(defaultCementingSnapshot.wellData);
    setDrillingFluid(defaultCementingSnapshot.drillingFluid);
    setSlurries(defaultCementingSnapshot.slurries);
    setBuffers(defaultCementingSnapshot.buffers);
    setDisplacementFluids(defaultCementingSnapshot.displacementFluids);
    setFractureGradient(defaultCementingSnapshot.fractureGradient);
    setFlushTimeMin(defaultCementingSnapshot.flushTimeMin);
    setFlushVolumeM3(defaultCementingSnapshot.flushVolumeM3);
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
