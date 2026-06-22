// Cross-module shared well data store.
// Lightweight subscribable store with localStorage persistence so that bridges,
// stimulation and cementing modules can share the well baseline parameters.

import { useEffect, useState } from "react";

export type SharedWellData = {
  // Identity
  fieldName?: string;
  padName?: string;
  wellName?: string;
  // Geometry
  wellDepthMD?: number; // м
  wellDepthTVD?: number; // м
  holeDiameter?: number; // мм
  casingShoe?: number; // м MD
  casingID?: number; // мм
  casingOD?: number; // мм
  // Reservoir
  reservoirTopMD?: number; // м
  reservoirBottomMD?: number; // м
  reservoirPressureMPa?: number;
  reservoirTempC?: number;
  // Fluids
  mudDensity?: number; // кг/м³
  // Source tag — which module last wrote
  source?: "cement-plug" | "stimulation" | "cementing" | "manual";
  updatedAt?: number;
};

const KEY = "shared-well-data-v1";
const listeners = new Set<() => void>();

function read(): SharedWellData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SharedWellData) : {};
  } catch {
    return {};
  }
}

export function getSharedWell(): SharedWellData {
  return read();
}

export function setSharedWell(patch: Partial<SharedWellData>, source: SharedWellData["source"] = "manual") {
  const next: SharedWellData = { ...read(), ...patch, source, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  listeners.forEach((l) => l());
}

export function clearSharedWell() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function useSharedWell(): [SharedWellData, (p: Partial<SharedWellData>, src?: SharedWellData["source"]) => void] {
  const [data, setData] = useState<SharedWellData>(() => read());
  useEffect(() => {
    const update = () => setData(read());
    listeners.add(update);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) update();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [data, setSharedWell];
}
