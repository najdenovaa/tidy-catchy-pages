import type {ReactNode} from 'react';

/** Native disclosure keeps its content mounted for state, charts and report collection. */
export default function ProgramDisclosure({title,children}:{title:string;children:ReactNode}){
 return <details className="program-panel"><summary>{title}</summary><div className="program-panel-body">{children}</div></details>;
}
