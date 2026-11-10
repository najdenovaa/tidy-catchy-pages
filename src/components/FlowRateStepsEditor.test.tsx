import { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FlowRateStepsEditor } from './InputSection';
import type { FlowRateStep } from '@/lib/cementing-calculations';
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Harness({total}: {total:number}) {
  const [steps,setSteps] = useState<FlowRateStep[]>([{rateLps:5,volumeM3:0,volumeMode:'auto'}]);
  return <FlowRateStepsEditor steps={steps} totalVolume={total} onChange={setSteps}/>;
}
describe('volume input', () => {
  it('fills automatically, follows changed intervals, preserves manual override and returns to auto', () => {
    vi.useFakeTimers();
    const r = render(<Harness total={3}/>);
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(3);
    r.rerender(<Harness total={8}/>);
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(8);
    fireEvent.change(screen.getAllByRole('spinbutton')[1], {target:{value:'4.5'}});
    fireEvent.blur(screen.getAllByRole('spinbutton')[1]);
    act(()=>vi.advanceTimersByTime(350));
    r.rerender(<Harness total={10}/>);
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(4.5);
    expect(screen.getByText(/Остаток:/).textContent).toContain('5.500');
    fireEvent.click(screen.getByRole('button',{name:'Авто'}));
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(10);
    fireEvent.click(screen.getByText('+ режим'));
    expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(5);
    expect(screen.getAllByRole('spinbutton')[3]).toHaveValue(5);
  });
});
