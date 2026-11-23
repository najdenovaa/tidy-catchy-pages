import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ insert: vi.fn(), session: vi.fn(), single: vi.fn(), eq: vi.fn(), from: vi.fn(), warning: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: mocks.session }, from: mocks.from,
} }));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }));
const snapshot = () => ({ module: 'cementing', title: 'Тест', well_data: { wellDepthMD: 3000 },
  calc_params: { drillingFluid: { density: 1200 }, slurries: [], buffers: [], displacementFluids: [], flushTimeMin: 10 }, results: { pressure: 42 } });
const outbox = () => Object.keys(localStorage).filter(k => k.startsWith('deallsoft-calculation-outbox-v1:'));
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

describe('calculation archive', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); localStorage.clear();
    let counter = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` });
    mocks.session.mockResolvedValue({ data: { session: null } });
    mocks.insert.mockResolvedValue({ error: null });
    const query = { select: vi.fn().mockReturnThis(), eq: mocks.eq.mockReturnThis(), single: mocks.single, insert: mocks.insert };
    mocks.from.mockReturnValue(query);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('archives a guest with detached complete inputs, results and a stable visitor ID', async () => {
    const archive = await import('./calculation-archive');
    const input = snapshot(); archive.recordCalculation(input); input.well_data.wellDepthMD = 1;
    await settle(); archive.recordCalculation(snapshot()); await settle();
    const first = mocks.insert.mock.calls[0][0], second = mocks.insert.mock.calls[1][0];
    expect(first.well_data.wellDepthMD).toBe(3000);
    expect(first.calc_params.__calculationArchive).toMatchObject({ schemaVersion: 1, userId: null, results: { pressure: 42 } });
    expect(first.calc_params.__calculationArchive.visitorId).toBe(second.calc_params.__calculationArchive.visitorId);
    expect(first.id).not.toBe(second.id); expect(outbox()).toHaveLength(0);
    expect(archive.archiveSnapshot(first)).toEqual(snapshot());
  });

  it('attaches an authenticated user before sending and retries a lost response with the same ID', async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mocks.insert.mockResolvedValueOnce({ error: { code: 'network' } }).mockResolvedValueOnce({ error: { code: '23505' } });
    const archive = await import('./calculation-archive'); archive.recordCalculation(snapshot()); await settle();
    expect(outbox()).toHaveLength(1); expect(mocks.warning).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.insert.mock.calls[0][0].id).toBe(mocks.insert.mock.calls[1][0].id);
    expect(mocks.insert.mock.calls[0][0].calc_params.__calculationArchive.userId).toBe('user-1');
    expect(outbox()).toHaveLength(0);
  });

  it('replays persisted records after reopening the app', async () => {
    localStorage.setItem('deallsoft-calculation-outbox-v1:pending', JSON.stringify({id:'pending', module:'workover', calc_params:{}, well_data:{}}));
    const archive = await import('./calculation-archive'); const stop = archive.startCalculationArchive(); await settle(); stop();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({id:'pending'})); expect(outbox()).toHaveLength(0);
  });

  it('only offers restoration for supported snapshots or complete legacy cementing logs', async () => {
    const archive = await import('./calculation-archive');
    expect(archive.archiveRoute({ module:'coiled-tubing', calc_params:null, well_data:null })).toBeNull();
    expect(archive.archiveRoute(snapshot())).toBe('/cementing/program');
    expect(() => archive.archiveSnapshot({ module:'cement-plug', calc_params:{cementDensity:1.85}, well_data:{} })).toThrow();
    expect(archive.archiveRoute({ module:'unknown', calc_params:{__calculationArchive:{schemaVersion:1}}, well_data:{} })).toBeNull();
  });

  it('opens the admin journal source without writing to it, and honors denied reads', async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { id:'admin' } } } });
    const archive = await import('./calculation-archive');
    const input = snapshot();
    mocks.single.mockResolvedValue({ data:{...input, calc_params:{...input.calc_params, __calculationArchive:{schemaVersion:1, results:input.results}}}, error:null });
    const data = await archive.loadCalculation(null, 'log-1', 'cementing');
    expect(data.well_data).toEqual(input.well_data); expect(data.results).toEqual(input.results);
    expect(mocks.from).toHaveBeenCalledWith('calculation_logs'); expect(mocks.insert).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({data:null, error:{code:'42501'}});
    await expect(archive.loadCalculation(null, 'log-1', 'cementing')).rejects.toThrow('недоступен');
    mocks.session.mockResolvedValue({data:{session:null}});
    await expect(archive.loadCalculation(null, 'log-1', 'cementing')).rejects.toThrow('войдите');
  });
});
