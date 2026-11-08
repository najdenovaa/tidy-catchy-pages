import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LabTargetsPanel from './LabTargetsPanel';
import { getCementingExample } from '@/lib/cementing-example';
import { normalizeSlurryInput } from '@/lib/cementing-normalizers';
import { applyProtocolToSlurries, buildLabProtocol, protocolToHtml } from '@/lib/lab-protocol';
import { applyDesignToSlurry, designToTargets } from '@/lib/cement-recipe-designer';
import { conditionsAll } from '@/lib/lab-protocol';
afterEach(cleanup);
const example = getCementingExample();
const input = { ...example, slurries: [{ ...example.slurries[0], name: 'Облегчённый ПЦТ-III-Об' }], pressure: null, volumes: null };

it('updates the recipe heading and applied binder from G to I-50 without offering ready blends', () => {
  const onApplySlurries = vi.fn();
  const onTargetsChange = vi.fn();
  const { rerender } = render(<LabTargetsPanel input={input} targets={[undefined]} onTargetsChange={onTargetsChange} onApplySlurries={onApplySlurries} />);
  expect(screen.getByText(/Раствор 1.*основа ПЦТ I-G/)).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /III-Об/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('ready-cement-alternatives')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Тампонажный цемент'), { target: { value: 'I50' } });
  expect(onTargetsChange).toHaveBeenCalledWith(0, { baseCement: 'I50' });
  rerender(<LabTargetsPanel input={input} targets={[{ baseCement: 'I50' }]} onTargetsChange={onTargetsChange} onApplySlurries={onApplySlurries} />);
  expect(screen.getByText(/Раствор 1.*Облегчённый раствор на ПЦТ I-50.*основа ПЦТ I-50/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Записать в программу$/ }));
  expect(onApplySlurries.mock.calls[0][0][0]).toMatchObject({ name: 'Облегчённый раствор на ПЦТ I-50', cementSG: 3.1, labTargets: { baseCement: 'I50' } });
});

it('corrects old built-in labels when loading but retains custom names and explicit saved blend data', () => {
  expect(normalizeSlurryInput(input.slurries[0]).name).toBe('Облегчённый раствор на ПЦТ I-G');
  expect(normalizeSlurryInput({ ...input.slurries[0], labTargets: { baseCement: 'I50' } }).name).toContain('I-50');
  const custom = normalizeSlurryInput({ ...input.slurries[0], name: 'Состав №12', cementSG: 2.6, labTargets: { baseCement: 'IIIOb' } });
  expect(custom).toMatchObject({ name: 'Состав №12', cementSG: 2.6, labTargets: { baseCement: 'IIIOb' } });
});

it('keeps the selected binder and ingredients through program, protocol and HTML report round trips', () => {
  for (const baseCement of ['G', 'I50'] as const) {
    const selected = { ...input, slurries: [{ ...input.slurries[0], labTargets: { baseCement } }] };
    const { protocol, designs } = buildLabProtocol(selected);
    expect(protocol.slurryNames[0]).toContain(baseCement === 'G' ? 'I-G' : 'I-50');
    expect(protocolToHtml(protocol)).not.toContain('III-Об');
    const written = applyProtocolToSlurries(protocol, input.slurries, designs);
    expect(written[0].labTargets?.baseCement).toBe(baseCement);
    expect(written[0].additives.length).toBeGreaterThan(0);
    const restored = normalizeSlurryInput(written[0]);
    expect(buildLabProtocol({ ...input, slurries: [restored] }).designs[0].baseCementShort).toBe(designs[0].baseCementShort);
    const condition = conditionsAll(selected).conditions[0];
    const d = designToTargets(condition, { baseCement }).design;
    expect(applyDesignToSlurry(input.slurries[0], d).name).toBe(written[0].name);
  }
});
