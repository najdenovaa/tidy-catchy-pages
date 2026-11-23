import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { toast } from 'sonner';

export interface CalculationSnapshot {
  module: string;
  title: string;
  well_data: unknown;
  calc_params: unknown;
  results: unknown;
}
export const ARCHIVE_KEY = '__calculationArchive';
const OUTBOX = 'deallsoft-calculation-outbox-v1:';
const VISITOR = 'deallsoft-visitor-v1';
const routes: Record<string, string> = {
  'foam-cement': '/cementing/program', cementing: '/cementing/program', 'cement-plug': '/cementing/plugs',
  'coiled-tubing': '/coiled-tubing', workover: '/workover', stimulation: '/stimulation',
  'cementing-woc': '/cementing/woc',
};
type Log = { module: string; well_data: Json | null; calc_params: Json | null };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function archiveMetadata(log: Log) {
  return object(object(log.calc_params)[ARCHIVE_KEY]);
}
export function archiveRoute(log: Log): string | null {
  if (!routes[log.module]) return null;
  const p = object(log.calc_params), w = object(log.well_data);
  const cementing = Boolean(w.wellDepthMD && p.drillingFluid && Array.isArray(p.slurries) &&
    Array.isArray(p.buffers) && Array.isArray(p.displacementFluids));
  // Older cementing logs already contain enough inputs for the existing normalizer.
  if (log.module === 'cementing') return cementing ? routes.cementing : null;
  if (archiveMetadata(log).schemaVersion !== 1) return null;
  const complete: Record<string, boolean> = {
    'foam-cement': cementing && Boolean(p.foamArchive && object(archiveMetadata(log).results).simulation),
    'cement-plug': Boolean(w.wellDepthMD && (p.placementMode === 'rir' ? object(p.rir).inp : p.plug && p.cement && p.spacer && p.wellFluid)),
    'coiled-tubing': Boolean(w.ct && w.well && w.fluid && w.pump && w.tools && Array.isArray(p.ctSections)),
    workover: Boolean(w.wellDepthMD && p.rig && p.packer && p.kill),
    stimulation: Boolean(w.reservoir && w.construction && p.composition),
    'cementing-woc': ['bhct', 'bhst', 'slurryDensity', 'tvd', 'totalHours'].every(key => typeof p[key] === 'number') && (p.cls === 'G' || p.cls === 'H'),
  };
  return complete[log.module] ? routes[log.module] : null;
}
export function archiveSnapshot(log: Log): CalculationSnapshot {
  if (!archiveRoute(log)) throw new Error('В этой записи недостаточно данных для восстановления расчёта');
  const { [ARCHIVE_KEY]: metadata, ...params } = object(log.calc_params);
  const meta = object(metadata);
  return {
    module: log.module, title: typeof meta.title === 'string' ? meta.title : 'Копия расчёта из журнала',
    well_data: log.well_data, calc_params: params, results: meta.results ?? null,
  };
}

/** RLS restricts journal reads to admins. Never use a service key in the browser. */
export async function loadCalculation(calcId: string | null, archiveId: string | null, module: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Для открытия расчёта войдите в аккаунт');
  if (archiveId) {
    const { data, error } = await supabase.from('calculation_logs').select('*').eq('id', archiveId).single();
    if (error || !data || (data.module !== module && !(module === 'cementing' && data.module === 'foam-cement'))) throw new Error('Расчёт из журнала недоступен');
    return { ...archiveSnapshot(data), user_id: session.user.id };
  }
  const { data, error } = await supabase.from('saved_calculations').select('*').eq('id', calcId!).eq('user_id', session.user.id).single();
  if (error || !data || data.module !== module) throw new Error('Не удалось загрузить расчёт');
  return data;
}

interface PendingRow { id: string; created_at: string; module: string; well_data: Json; calc_params: Json; page_url: string; user_agent: string; }
let queue: PendingRow[] | undefined;
const identities = new Map<string, Promise<void>>();
let flushing = false;
let retry: ReturnType<typeof setTimeout> | undefined;
function pending() {
  if (!queue) {
    queue = [];
    try {
      for (const key of Object.keys(localStorage).filter(key => key.startsWith(OUTBOX))) {
        try {
          const row = JSON.parse(localStorage.getItem(key)!);
          if (row?.id && row?.module && row?.calc_params) queue.push(row);
        } catch { /* preserve the remaining pending calculations */ }
      }
    } catch { /* storage unavailable; the in-memory queue still works */ }
    if (!Array.isArray(queue)) queue = [];
  }
  return queue!;
}
function persist(row: PendingRow) {
  try { localStorage.setItem(OUTBOX + row.id, JSON.stringify(row)); }
  catch { toast.warning('Браузер не сохранил очередь расчётов. Не закрывайте страницу до отправки.'); }
}
export async function flushCalculationArchive() {
  if (flushing || !pending().length) return;
  flushing = true;
  try {
    while (pending().length) {
      const row = pending()[0];
      await identities.get(row.id);
      const { error } = await supabase.from('calculation_logs').insert(row);
      // A lost HTTP response must not create a second record on retry.
      if (error && error.code !== '23505') throw error;
      pending().shift();
      try { localStorage.removeItem(OUTBOX + row.id); } catch { /* duplicate ID makes retries safe */ }
    }
  } catch {
    toast.warning('Расчёт выполнен. Отправка в журнал отложена; повторим автоматически.', { id: 'calculation-archive-retry' });
    if (!retry) retry = setTimeout(() => { retry = undefined; void flushCalculationArchive(); }, 15000);
  } finally { flushing = false; }
}
export function startCalculationArchive() {
  void flushCalculationArchive();
  window.addEventListener('online', flushCalculationArchive);
  return () => window.removeEventListener('online', flushCalculationArchive);
}
export function recordCalculation(snapshot: CalculationSnapshot) {
  // Capture a detached snapshot immediately, before a subsequent edit can mutate it.
  const id = crypto.randomUUID();
  let visitor: string = id;
  try { visitor = localStorage.getItem(VISITOR) || id; localStorage.setItem(VISITOR, visitor); } catch { /* per-calculation fallback */ }
  const row: PendingRow = JSON.parse(JSON.stringify({
    id, created_at: new Date().toISOString(), module: snapshot.module,
    well_data: snapshot.well_data,
    calc_params: { ...object(snapshot.calc_params), [ARCHIVE_KEY]: {
      schemaVersion: 1, appVersion: import.meta.env.VITE_APP_VERSION || 'development',
      visitorId: visitor, userId: null, title: snapshot.title, results: snapshot.results,
    } },
    page_url: window.location.href, user_agent: navigator.userAgent,
  }));
  pending().push(row);
  persist(row);
  const identity = supabase.auth.getSession().then(({ data: { session } }) => {
    object(object(row.calc_params)[ARCHIVE_KEY]).userId = session?.user.id ?? null;
    persist(row);
  }).catch(() => {}).finally(() => { identities.delete(id); });
  identities.set(id, identity);
  void flushCalculationArchive();
}
