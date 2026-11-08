import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CementProductPicker, RecipeProductsPanel } from './CementProductPicker';
import CementingEquipmentCard from './CementingEquipmentCard';
import { getCementingExample } from '@/lib/cementing-example';
afterEach(cleanup);
it('offers compatible RIR product roles without substituting microsilica for quartz flour', () => {
  const onSelect = vi.fn();
  const { rerender } = render(<CementProductPicker use="cement" role="fla" onSelect={onSelect} />);
  expect(screen.getByRole('option', { name: /IG FLice/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /МКУ/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ig-flice' } });
  expect(onSelect.mock.calls[0][0].manufacturer).toBe('IG chemical / Айсберг');
  rerender(<CementProductPicker use="cement" role="silica_flour" onSelect={onSelect} />);
  expect(screen.queryByRole('option', { name: /МКУ/ })).not.toBeInTheDocument();
});
it('chooses a recipe product without inserting a guessed product density', () => {
  const onChange = vi.fn();
  render(<RecipeProductsPanel roles={['dispersant']} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText(/Поликарбоксилатный диспергатор/));
  expect(onChange).toHaveBeenCalledWith({ dispersant: { id: 'ig-flex' } });
});
it('adds a manufacturer equipment item, then changes category to plugs', () => {
  const onChange = vi.fn();
  render(<CementingEquipmentCard well={getCementingExample().wellData} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Изделие Аврора'), { target: { value: 'avrora-112pb' } });
  const e = onChange.mock.calls[0][0].equipment[0];
  expect(e).toMatchObject({ model: 'AVRORA 112ПБ', manufacturer: 'ООО «Аврора»', quantity: 1 });
  expect(e.casingOD).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Категория оснастки'), { target: { value: 'upperPlug' } });
  expect(screen.getByRole('option', { name: 'AVRORA 141-П Plug Up' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'AVRORA 112ПБ' })).not.toBeInTheDocument();
});
