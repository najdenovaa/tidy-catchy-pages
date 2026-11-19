import {render,screen,cleanup} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import D2AnnularBalance from './D2AnnularBalance';
import {sectionFixture} from '@/lib/__tests__/fixtures/displacement-section-fixture';
afterEach(cleanup);
it('requires recalculation for old data and blocks stale exports',()=>{
 const r=sectionFixture().result!;const view=render(<D2AnnularBalance res={r} frame={0} offsetS={120} stale={false}/>);
 expect(screen.getByRole('status')).toHaveTextContent('баланс отсутствует');expect(screen.getByText('Баланс затрубья в XLSX')).toBeDisabled();
 const a=[1,0],zero=[0,0];r.snapshots[0].balance={initialM3:a,sourceInM3:zero,boundaryInM3:zero,outletM3:zero,insideM3:a,residualM3:zero,clippingM3:zero,normalizationM3:zero,unexplainedM3:zero,quantizationM3:zero};
 view.rerender(<D2AnnularBalance res={r} frame={0} offsetS={120} stale/>);expect(screen.getByText('Баланс затрубья в XLSX')).toBeDisabled();expect(screen.getByText(/2.000 мин от начала/)).toBeInTheDocument();expect(screen.getByText('Округление 3D, м³')).toBeInTheDocument();
});
