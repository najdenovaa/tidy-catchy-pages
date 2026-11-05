import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { SqueezeSimResult } from "@/lib/rir-squeeze-sim";
/** One trace index can be shared by the pressure charts and the 3D view. */
export function useRirCursor(
  sim: SqueezeSimResult,
  controlled?: number,
  onChange?: (index: number) => void,
) {
  const [local, setLocal] = useState(sim.points.length - 1),
    [playing, setPlaying] = useState(false);
  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(sim.points.length - 1, n)),
    [sim.points.length],
  );
  const index = clamp(controlled ?? local),
    current = useRef(index);
  current.current = index;
  const setIndex = useCallback(
    (value: SetStateAction<number>) => {
      const next = clamp(
        typeof value === "function" ? value(current.current) : value,
      );
      current.current = next;
      setLocal(next);
      onChange?.(next);
    },
    [clamp, onChange],
  );
  useEffect(() => {
    setPlaying(false);
    setIndex(sim.points.length - 1);
  }, [sim, setIndex]);
  useEffect(() => {
    if (!playing || sim.blocked) return;
    const step = Math.max(1, Math.round(sim.points.length / 240));
    const timer = window.setInterval(
      () =>
        setIndex((i) => {
          if (i + step >= sim.points.length - 1) {
            setPlaying(false);
            return sim.points.length - 1;
          }
          return i + step;
        }),
      45,
    );
    return () => clearInterval(timer);
  }, [playing, sim, setIndex]);
  return { index, setIndex, playing, setPlaying };
}
