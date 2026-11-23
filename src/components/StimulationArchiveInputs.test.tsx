import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SolventCalcPanel from './SolventCalcPanel';
import NitrogenCalcPanel from './NitrogenCalcPanel';
it('restores solvent panel inputs and reports subsequent edits for archival', async () => {
  const inputs = {solvent:'toluene' as const,damageType:'asphaltene' as const,penetrationR:2,satPct:18,surfaceT:85,tubingDepth:1723,rate:0.2,tubingOD:89};
  const changed = vi.fn();
  render(<SolventCalcPanel payZoneM={10} porosity={0.2} reservoirTempC={60} defaultDamage="asphaltene" initialInputs={inputs} onInputsChange={changed}/>);
  expect(screen.getByDisplayValue('1723')).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(inputs));
  fireEvent.change(screen.getByDisplayValue('1723'),{target:{value:'1823'}});
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({...inputs,tubingDepth:1823}));
});
it('restores nitrogen panel settings, including pressure and foam quality', async () => {
  const inputs = {wellDepth:2731,tubingID:62,fluidDensity:1050,surfaceT:25,targetBhp:12,foamQ:82,pumpRate:17};
  const changed = vi.fn();
  render(<NitrogenCalcPanel reservoirPressureMPa={30} reservoirTempC={60} operationType="n2_foam_lift" initialInputs={inputs} onInputsChange={changed}/>);
  expect(screen.getByDisplayValue('2731')).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(inputs));
});
