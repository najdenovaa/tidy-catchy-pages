import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import CentralizerPassportFields from './CentralizerPassportFields';
import type { CentralizerSpec } from '@/lib/centralization-calculations';

it('выбирает паспорт и переносит исходные единицы и тип в обе формы расстановки', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let spec: CentralizerSpec = {type:'rigid',bladesCount:6,bladeHeight:25,restoringForce:15,maxAxialLoad:300};
  const render = () => root.render(<CentralizerPassportFields spec={spec} casingOD={178} onChange={value => {spec=value; render();}} />);
  try {
    await act(async () => render());
    const select = host.querySelector('select')!;
    await act(async () => { select.value='spring178'; select.dispatchEvent(new Event('change', {bubbles:true})); });
    expect(spec.type).toBe('spring');
    expect(spec.passport?.restoringForceKgf).toBe(507);
    expect(spec.restoringForce).toBeCloseTo(4.97197,5);
    expect(host.textContent).toContain('Восстанавливающее усилие, не менее, кгс');
    expect(host.textContent).toContain('кН (если паспорт использует кН)');
    await act(async () => { select.value='highslick560'; select.dispatchEvent(new Event('change', {bubbles:true})); });
    expect(spec.passport?.outerDiameter).toBe(212);
    expect(spec.restoringForce).toBe(0);
    expect(host.textContent).not.toContain('Восстанавливающее усилие, не менее, кгс');
    expect(host.textContent).toContain('35 Н·м');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
