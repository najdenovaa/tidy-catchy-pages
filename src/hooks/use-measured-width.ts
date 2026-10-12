import { useEffect, useRef, useState } from "react";

/** Ширина контейнера для графиков (ResizeObserver; нулевые замеры скрытой вкладки игнорируются). */
export function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
