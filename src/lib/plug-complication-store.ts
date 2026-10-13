import { useEffect, useState } from "react";

/** Общие параметры осложнений моста: блок «Осложнения» и итоговый расчёт читают одно и то же. */
export const COMPL_KEY = "cement_plug_complications_v1";
const EVT = "plug-compl-change";

export function readComplParams(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(COMPL_KEY) || "{}"); } catch { return {}; }
}

export function writeComplParams(patch: Record<string, unknown>) {
  try {
    const all = { ...readComplParams(), ...patch };
    localStorage.setItem(COMPL_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch { /* хранилище недоступно */ }
}

export function usePlugComplParams(): Record<string, unknown> {
  const [v, setV] = useState(readComplParams);
  useEffect(() => {
    const h = () => setV(readComplParams());
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return v;
}
