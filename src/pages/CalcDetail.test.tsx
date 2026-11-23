import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
const { from } = vi.hoisted(() => ({ from:vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({supabase: {
  auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'admin'}}}})}, from,
}}));
import CalcDetail from './CalcDetail';
it('offers a separate working copy and historical results for a guest calculation', async () => {
  const entry = { id:'log-1', module:'cementing', created_at:'2026-11-23T12:00:00Z',
    well_data:{wellDepthMD:3000}, calc_params:{drillingFluid:{density:1200},slurries:[],buffers:[],displacementFluids:[],
      __calculationArchive:{schemaVersion:1,userId:null,visitorId:'guest-123',appVersion:'abc123',results:{pressure:42}}},
  };
  from.mockImplementation((table:string) => {
    const query = {select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),limit:vi.fn().mockResolvedValue({data:[{role:'admin'}]}),maybeSingle:vi.fn().mockResolvedValue({data:entry})};
    return query;
  });
  render(<MemoryRouter initialEntries={['/admin/calc/log-1']}><Routes><Route path="/admin/calc/:id" element={<CalcDetail/>}/></Routes></MemoryRouter>);
  const link = (await screen.findByRole('button',{name:'Открыть расчёт в программе'})).closest('a');
  expect(link).toHaveAttribute('href','/cementing/program?archive=log-1');
  expect(link).toHaveAttribute('target','_blank');
  expect(screen.getByText('Сохранённые результаты')).toBeInTheDocument();
  expect(screen.getByText(/guest-123/)).toHaveTextContent('Гость');
});
