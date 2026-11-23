import { useEffect, useRef } from 'react';
import { recordCalculation, type CalculationSnapshot } from '@/lib/calculation-archive';

/** Live modules have no Calculate button. Record once inputs settle; never on each keypress. */
export function useLiveCalculationArchive(build: () => CalculationSnapshot, enabled = true) {
  const latest = useRef(build);
  latest.current = build;
  const payload = build();
  const key = JSON.stringify([payload.module, payload.well_data, payload.calc_params]);
  const previous = useRef(key);
  const current = useRef({ key, enabled });
  current.current = { key, enabled };
  useEffect(() => {
    const flush = () => {
      if (current.current.enabled && previous.current !== current.current.key) {
        previous.current = current.current.key;
        recordCalculation(latest.current());
      }
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  useEffect(() => {
    if (!enabled) { previous.current = key; return; }
    if (previous.current === key) return;
    const timer = setTimeout(() => {
      previous.current = key;
      recordCalculation(latest.current());
    }, 1500);
    return () => clearTimeout(timer);
  }, [key, enabled]);
}
