import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Printer, Download, ArrowRightLeft, RotateCcw, Plus, X } from "lucide-react";
import { buildLabProtocol, applyProtocolToSlurries, protocolToHtml, type LabProtocol, type ProtocolInput } from "@/lib/lab-protocol";
import { exportLabProtocolDocx } from "@/lib/export-lab-protocol-docx";
import type { SlurryDesign } from "@/lib/cement-recipe-designer";
import type { SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  input: ProtocolInput;
  onApplySlurries?: (slurries: SlurryInput[]) => void;
}

interface Stored { protocol: LabProtocol; designs: SlurryDesign[]; edited: boolean }
const KEY = "deallsoft:cement-lab-protocol:v1";

function load(): Stored | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Stored) : null; } catch { return null; }
}
function save(s: Stored | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* хранилище недоступно */ }
}

/** Редактируемый текст: правка прямо в документе, сохранение при выходе из поля. */
function Editable({ value, onChange, className = "", placeholder }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <div
      key={value}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={`outline-none rounded-sm focus:bg-amber-50 focus:ring-1 focus:ring-amber-300 dark:focus:bg-amber-950/40 whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60 ${className}`}
      onBlur={(e) => { const v = e.currentTarget.innerText.replace(/\n$/, ""); if (v !== value) onChange(v); }}
      onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
    >
      {value}
    </div>
  );
}

export default function LabProtocolPanel({ input, onApplySlurries }: Props) {
  const [state, setState] = useState<Stored | null>(() => load());
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { save(state); }, [state]);

  const generate = (force = false) => {
    if (!force && state?.edited && !window.confirm("Протокол содержит ваши правки. Сформировать заново по текущей программе? Правки будут потеряны.")) return;
    const { protocol, designs } = buildLabProtocol(input);
    setState({ protocol, designs, edited: false });
    setMsg(null);
  };

  const update = (fn: (p: LabProtocol) => LabProtocol) => setState((s) => (s ? { ...s, protocol: fn(structuredClone(s.protocol)), edited: true } : s));

  const print = () => {
    if (!state) return;
    const win = window.open("", "_blank");
    if (!win) { setMsg("Браузер заблокировал окно печати — разрешите всплывающие окна для сайта."); return; }
    win.document.write(protocolToHtml(state.protocol));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const apply = () => {
    if (!state || !onApplySlurries) return;
    if (state.protocol.slurryNames.length !== input.slurries.length) {
      setMsg("Число растворов в программе изменилось после формирования протокола — сформируйте протокол заново."); return;
    }
    onApplySlurries(applyProtocolToSlurries(state.protocol, input.slurries, state.designs));
    setMsg("Рецептура записана в программу: добавки (с вашими правками в таблице), В/С и выход по абсолютным объёмам, реология и время загустевания — прогноз (замеренные значения не перезаписываются). Расчёт обновлён.");
  };

  const p = state?.protocol;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-3xl">
          <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Расчётный лабораторный протокол</h3>
          <p className="text-xs text-muted-foreground">
            Система подбирает рецептуру под условия скважины — тип цемента, облегчение или утяжеление, замедлитель, понизитель водоотдачи,
            пластификатор, газоблокатор, стабилизатор — и прогнозирует свойства: реологию, водоотдачу, загустевание, прочность.
            Протокол редактируется прямо здесь (щёлкните по любому значению), печатается и выгружается в Word.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => generate()}><FileText className="h-4 w-4 mr-1" />{p ? "Сформировать заново" : "Сформировать лабораторный протокол"}</Button>
        </div>
      </div>

      {p && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <Button size="sm" variant="outline" onClick={() => exportLabProtocolDocx(p, `Протокол_${p.title.replace(/[^\wА-Яа-яЁё-]+/g, "_")}.docx`)}><Download className="h-4 w-4 mr-1" />Word</Button>
            <Button size="sm" variant="outline" onClick={print}><Printer className="h-4 w-4 mr-1" />Печать / PDF</Button>
            {onApplySlurries && <Button size="sm" variant="outline" onClick={apply}><ArrowRightLeft className="h-4 w-4 mr-1" />Записать рецептуру в программу</Button>}
            {state?.edited && <span className="text-xs text-amber-600">есть ваши правки</span>}
            {state?.edited && (
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Сбросить все правки к расчёту?")) generate(true); }}>
                <RotateCcw className="h-4 w-4 mr-1" />Сбросить правки
              </Button>
            )}
          </div>
          {msg && <div className="text-xs rounded-md border border-border bg-muted/40 p-2">{msg}</div>}

          <div className="rounded-md border border-border bg-white text-black shadow-sm p-5 sm:p-8 space-y-3 font-serif text-[13px] leading-snug dark:bg-neutral-50">
            <Editable className="text-center font-bold text-base" value={p.title} onChange={(v) => update((x) => ({ ...x, title: v }))} />
            <Editable className="text-center" value={p.subtitle} onChange={(v) => update((x) => ({ ...x, subtitle: v }))} />
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {p.meta.map((m, i) => (
                  <tr key={m.label}>
                    <td className="border border-black px-2 py-1 font-semibold w-1/3">{m.label}</td>
                    <td className="border border-black px-2 py-1">
                      <Editable value={m.value} placeholder="заполнить" onChange={(v) => update((x) => { x.meta[i].value = v; return x; })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Editable className="border border-black p-2 italic text-[11.5px]" value={p.status} onChange={(v) => update((x) => ({ ...x, status: v }))} />

            {p.sections.map((s, si) => (
              <section key={s.id} className="space-y-1.5 pt-1">
                <Editable className="font-bold text-[13.5px]" value={s.title} onChange={(v) => update((x) => { x.sections[si].title = v; return x; })} />
                {(s.paragraphs ?? []).map((para, pi) => (
                  <Editable key={pi} value={para} onChange={(v) => update((x) => { x.sections[si].paragraphs![pi] = v; return x; })} />
                ))}
                {(s.tables ?? []).map((t, ti) => (
                  <div key={t.id} className="overflow-x-auto">
                    <table className="w-full border-collapse text-[11.5px]">
                      <thead>
                        <tr>{t.headers.map((h, hi) => <th key={hi} className="border border-black bg-neutral-200 px-1.5 py-1 text-left align-top" style={t.widths?.[hi] ? { width: `${t.widths[hi]}%` } : undefined}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, ri) => (
                          <tr key={ri} className="group">
                            {r.map((c, ci) => (
                              <td key={ci} className={`border border-black px-1.5 py-0.5 align-top ${/НЕ соответствует/.test(c) ? "text-red-700 font-semibold" : ""} ${t.headers[ci] === "Факт" ? "bg-amber-50/60" : ""}`}>
                                <div className="flex items-start gap-1">
                                  <Editable className="flex-1 min-w-[1.5rem]" value={c} placeholder={t.headers[ci] === "Факт" ? "…" : ""}
                                    onChange={(v) => update((x) => { x.sections[si].tables![ti].rows[ri][ci] = v; return x; })} />
                                  {ci === r.length - 1 && (
                                    <button title="Удалить строку" className="opacity-0 group-hover:opacity-100 text-red-600 print:hidden"
                                      onClick={() => update((x) => { x.sections[si].tables![ti].rows.splice(ri, 1); return x; })}>
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="text-[11px] text-blue-700 hover:underline mt-0.5 flex items-center gap-0.5"
                      onClick={() => update((x) => { x.sections[si].tables![ti].rows.push(t.headers.map(() => "")); return x; })}>
                      <Plus className="h-3 w-3" /> строка
                    </button>
                  </div>
                ))}
                {s.bullets?.length ? (
                  <ul className="list-disc pl-5 space-y-0.5 text-[12px]">
                    {s.bullets.map((b, bi) => (
                      <li key={bi}><Editable value={b} onChange={(v) => update((x) => { x.sections[si].bullets![bi] = v; return x; })} /></li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}

            <table className="w-full text-[12px] mt-6">
              <tbody>
                {p.signatures.map((sg, i) => (
                  <tr key={sg.role}>
                    <td className="py-3 w-2/5">{sg.role}</td>
                    <td className="py-3"><div className="flex gap-1 items-end">____________________ <Editable className="min-w-[8rem]" value={sg.name} placeholder="Ф. И. О." onChange={(v) => update((x) => { x.signatures[i].name = v; return x; })} /></div></td>
                    <td className="py-3 w-1/5">«___» ________ 20__ г.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
