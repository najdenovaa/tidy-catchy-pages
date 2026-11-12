import {it,expect,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import CoupledStudyView from './CoupledStudyView';
import {evaluateCoupledRefinement} from '@/lib/coupled-refinement';
import {movingPlugReference} from '@/lib/moving-plug';
afterEach(cleanup);
it('shows unavailable refinement limits without fake zero rows or export buttons',()=>{render(<CoupledStudyView study={evaluateCoupledRefinement(movingPlugReference(),16,10,0)}/>);expect(screen.getByRole('alert')).toHaveTextContent('1-15');expect(screen.queryByRole('table')).not.toBeInTheDocument();expect(screen.queryByRole('button')).not.toBeInTheDocument();});
