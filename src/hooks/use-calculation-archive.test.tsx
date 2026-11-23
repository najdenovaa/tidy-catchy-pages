import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLiveCalculationArchive } from './use-calculation-archive';
const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/lib/calculation-archive', () => ({ recordCalculation: record }));
afterEach(() => { vi.useRealTimers(); record.mockClear(); });
it('coalesces typing, skips initial/default inputs and loading, and archives edits after loading', () => {
  vi.useFakeTimers();
  const { rerender } = renderHook(({depth, enabled}) => useLiveCalculationArchive(() => ({ module:'workover', title:'КРС', well_data:{depth}, calc_params:{}, results:{value:depth*2} }), enabled), {initialProps:{depth:1, enabled:false}});
  rerender({depth:2000, enabled:false}); rerender({depth:2000, enabled:true});
  act(() => vi.advanceTimersByTime(2000)); expect(record).not.toHaveBeenCalled();
  rerender({depth:2100, enabled:true}); act(() => vi.advanceTimersByTime(1000));
  rerender({depth:2200, enabled:true}); act(() => vi.advanceTimersByTime(1500));
  expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0][0]).toMatchObject({well_data:{depth:2200},results:{value:4400}});
});

it('preserves the last live calculation when leaving before the debounce expires', () => {
  vi.useFakeTimers();
  const { rerender, unmount } = renderHook(({depth}) => useLiveCalculationArchive(() => ({ module:'workover', title:'КРС', well_data:{depth}, calc_params:{}, results:{} })), {initialProps:{depth:1}});
  rerender({depth:2200}); unmount();
  expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0][0].well_data).toEqual({depth:2200});
});
