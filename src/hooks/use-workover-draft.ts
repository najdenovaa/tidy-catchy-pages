import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { validateWorkoverPart } from '@/lib/workover-validation';

export function restoreWorkoverDraft<T>(raw: string | null, fallback: T, part: string): T {
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw);
    if (Array.isArray(fallback) !== Array.isArray(saved) || typeof saved !== typeof fallback || saved === null) return fallback;
    if(typeof fallback==='object' && !Array.isArray(fallback)) {
      for(const [key,val] of Object.entries(fallback)) {
        if(key in saved && (saved[key]===null || typeof saved[key]!==typeof val || Array.isArray(saved[key])!==Array.isArray(val))) return fallback;
      }
    }
    const next = !Array.isArray(fallback) && typeof fallback === 'object' ? {...fallback,...saved} : saved;
    return validateWorkoverPart(part,next).length ? fallback : next;
  } catch { return fallback; }
}

/** Each calculation/well has its own draft. Cabinet loading overwrites the same draft explicitly. */
export function useWorkoverDraft<T>(scope: string, part: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key=`workover_draft_v2:${scope}:${part}`;
  const [state,setState]=useState<T>(()=>{
    try { return restoreWorkoverDraft(localStorage.getItem(key),initial,part); } catch { return initial; }
  });
  useEffect(()=>{try { localStorage.setItem(key,JSON.stringify(state)); } catch { toast.error('Не удалось сохранить черновик в браузере. Сохраните расчёт в кабинет.',{id:'workover-storage'}); }},[key,state]);
  const current=useRef(state);
  current.current=state;
  const commit: Dispatch<SetStateAction<T>> = (action) => {
    const next = typeof action === 'function' ? (action as (current:T)=>T)(current.current) : action;
    const errors=validateWorkoverPart(part,next);
    if(errors.length){toast.error(errors[0]);return;}
    current.current=next;
    setState(next);
  };
  return [state,commit];
}
