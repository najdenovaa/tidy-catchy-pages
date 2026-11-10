import { CEMENT_PRODUCTS, cementProduct, type CementProduct, type ProductChoices, productWarnings } from '@/lib/cement-product-catalog';
const cls = 'w-full min-w-0 rounded border border-border bg-background p-1.5 text-xs';
export function CementProductPicker({ use, role, value = '', onSelect }: { use: 'cement' | 'buffer'; role?: string; value?: string; onSelect: (p: CementProduct) => void }) {
  return <select className={cls} aria-label="Реагент из каталога изготовителя" value={value} onChange={e => { const p = cementProduct(e.target.value); if (p) onSelect(p); }}>
    <option value="">Выбрать реагент IG chemical</option>
    {CEMENT_PRODUCTS.filter(p => p.use === use && (!role || role === 'additive' || p.role === (role === 'fla' ? 'fluidLoss' : role) || (role === 'silica' && p.role === 'microsilica'))).map(p => <option key={p.id} value={p.id}>{p.name} - {p.purpose}</option>)}
  </select>;
}
export function RecipeProductsPanel({ choices, onChange, roles }: { choices?: ProductChoices; onChange: (v: ProductChoices | undefined) => void; roles: string[] }) {
  const set = (role: keyof ProductChoices, value: ProductChoices[typeof role]) => {
    const n = { ...choices }; if (value) n[role] = value; else delete n[role]; onChange(Object.keys(n).length ? n : undefined);
  };
  const products = CEMENT_PRODUCTS.filter(p => ['retarder', 'fluidLoss', 'dispersant', 'defoamer'].includes(p.role) && roles.includes(p.role));
  return <details className="rounded border border-border p-2 text-xs" open={Object.keys(choices ?? {}).length > 0 || undefined}>
    <summary className="cursor-pointer font-medium">Марки реагентов и производитель</summary>
    <p className="my-2 text-muted-foreground">Выберите коммерческую марку для добавки. Дозировка сохраняется; диапазон изготовителя проверяется. В программе все реагенты рассчитываются по массовой процентовке, как стандартная химия: % BWOC для цемента и % массы готового раствора для буфера. Объёмные указания изготовителя не используются как массовые проценты. Прогноз типовой корреляции требует испытания фактического продукта. SG без паспорта остаётся модельным допущением; насыпная плотность не используется.</p>
    {products.length === 0 && <p>Сначала добавьте замедлитель, понизитель водоотдачи, диспергатор или пеногаситель в рецептуру.</p>}
    {products.map(p => { const role = p.role as keyof ProductChoices, v = choices?.[role], selected = v?.id === p.id; return <div key={p.id} className="space-y-1 border-t py-2">
      <label className="flex gap-2"><input type="checkbox" checked={selected} onChange={e => set(role, e.target.checked ? { id: p.id } : undefined)} />{p.purpose}: {p.name}</label>
      {selected && <><p>{p.manufacturer} · {p.technicalSpec}</p><p>Расчёт в программе: % от массы базового цемента (BWOC).</p><p>В источнике изготовителя: {p.dosage}</p><p className="text-muted-foreground">{p.note}</p>
        <div className="grid grid-cols-2 gap-2"><label>Истинная плотность по паспорту, г/см³<input className={cls} type="number" min="0" step="0.01" value={v?.sg ?? ''} placeholder="Не опубликована" onChange={e => set(role, { ...v!, sg: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} /></label>
        <label>Партия<input className={cls} value={v?.batch ?? ''} onChange={e => set(role, { ...v!, batch: e.target.value })} /></label></div>
        <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">Источник изготовителя</a></>}
    </div>; })}
  </details>;
}
export function ProductDetails({ productId, doseBwoc, temperatureC }: { productId?: string; doseBwoc?: number; temperatureC?: number }) {
  const p = cementProduct(productId); if (!p) return null;
  return <div className="basis-full text-[11px] space-y-1"><p>{p.manufacturer} · {p.technicalSpec}</p><p>Расчёт: {p.use==='cement'?'% от массы базового цемента (BWOC)':'% от массы готового буфера'}. В источнике изготовителя: {p.dosage}</p>
    {productWarnings(p, doseBwoc, temperatureC).map(n => <p key={n} className="text-amber-700 dark:text-amber-400">{n}</p>)}
    <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">Характеристики изготовителя</a></div>;
}
