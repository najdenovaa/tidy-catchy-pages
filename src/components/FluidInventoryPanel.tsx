import type {PressureProfileResult} from '@/lib/cementing-calculations';
export default function FluidInventoryPanel({result}:{result:PressureProfileResult}){
 const a=result.inventory;if(!a)return null;
 const names=new Map(result.processContract?.fluids.map(f=>[f.id,f.name])??[]);names.set('mud:initial','Исходный буровой раствор');
 const valid=a.maxStepResidualKg<1e-4&&a.maxStepResidualM3<1e-7;
 return <section className="border rounded-lg p-4 mb-4 space-y-3">
 <h3 className="font-semibold">Баланс жидкостей в скважине</h3>
 <p role={valid?'status':'alert'} className={valid?'text-sm':'text-sm text-destructive'}>{valid?'Численный баланс сходится в рамках модели постоянной плотности.':'Обнаружена невязка переноса. Результат требует проверки.'}</p>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
 <p>Закачано<br/><b>{a.injectedM3.toFixed(3)} м³</b></p><p>Расчётный возврат<br/><b>{a.returnedM3.toFixed(3)} м³</b></p><p>Незаполненный объём трубы<br/><b>{a.pipeVoidM3.toFixed(3)} м³</b></p><p>Масса в скважине<br/><b>{(a.retainedMassKg/1000).toFixed(3)} т</b></p>
 </div>
 <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Жидкость','Исходно, м³','Вход, м³','Труба, м³','Затрубье, м³','Возврат, м³'].map(t=><th key={t} className="p-2 text-left">{t}</th>)}</tr></thead><tbody>{a.fluids.map(f=><tr key={f.fluidId}>{[names.get(f.fluidId)??f.fluidId,...[f.initialM3,f.injectedM3,f.pipeM3,f.annulusM3,f.returnedM3].map(v=>v.toFixed(3))].map((v,i)=><td key={i} className="p-2 border-t">{v}</td>)}</tr>)}</tbody></table></div>
 <p className="text-xs">Максимальная пошаговая невязка: {a.maxStepResidualM3.toExponential(2)} м³; {a.maxStepResidualKg.toExponential(2)} кг.</p>
 {a.limitations.map(t=><p key={t} className="text-xs text-muted-foreground">{t}</p>)}
 </section>;
}
