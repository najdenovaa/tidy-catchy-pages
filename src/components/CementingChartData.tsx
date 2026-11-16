import {rheologyCoverage} from '@/lib/rheology-workbook';
import ChartPresentationEditor from './ChartPresentationEditor';
import type {ChartPresentations} from '@/lib/chart-presentation';
import {useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import {Card,CardHeader,CardTitle,CardContent} from './ui/card';
import {Button} from './ui/button';
import {cementingNumericCharts,chartCoverage,cementingChartsWorkbook} from '@/lib/cementing-chart-data';
import type {PressureProfileResult} from '@/lib/cementing-calculations';
import type {DepthChartSettings} from '@/lib/depth-chart-settings';
export default function CementingChartData({result,settings,presentations,onPresentationsChange}:{result:Parameters<typeof cementingNumericCharts>[0];settings?:DepthChartSettings;presentations?:ChartPresentations;onPresentationsChange?:(s:ChartPresentations)=>void}){
 const plots=useMemo(()=>cementingNumericCharts(result,settings,undefined,presentations),[result,settings,presentations]);
 const coverage=useMemo(()=>chartCoverage(plots),[plots]);
 const [error,setError]=useState('');
 return <Card><CardHeader><CardTitle className="text-lg">Данные графиков и выгрузка XLSX</CardTitle></CardHeader><CardContent className="space-y-3">
  <p className="text-xs text-muted-foreground">Основные гидравлические графики текущего расчёта, выбранная глубина, сжатие после посадки и корзины после Стоп. Полные числовые ряды без прореживания; пустые значения сохраняются. При наличии актуального результата включено пеноцементирование. Включена реология жидкостей расчётного снимка: замеры, кривые и отклонения. Остальные лабораторные данные, центрирование, дохождение и 3D в эту выгрузку не входят.</p>
  <Button onClick={()=>{try{setError('');XLSX.writeFile(cementingChartsWorkbook(result,settings,undefined,presentations),'Данные-графиков-цементирования.xlsx');}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Скачать данные графиков XLSX</Button>
  {error&&<p role="alert" className="text-destructive text-xs">{error}</p>}
  <ChartPresentationEditor plots={plots} presentations={presentations} onChange={onPresentationsChange}/>
  {result.rheologyInput&&<details><summary className="text-sm cursor-pointer">Реология: наличие замеров по жидкостям</summary><div className="overflow-auto"><table className="text-xs w-full"><thead><tr><th>Жидкость</th><th>Кривые</th><th>Применяется в гидравлике</th><th>Источник</th></tr></thead><tbody>{rheologyCoverage(result.rheologyInput).map(f=><tr key={f.id}><td className="p-2">{f.name}</td><td>{f.status}</td><td>{f.data.applied.label}{!f.data.applied.valid&&': '+f.data.applied.error}</td><td>{f.appliedSource}</td></tr>)}</tbody></table></div></details>}
  <details><summary className="text-sm cursor-pointer">Карта графиков: наличие данных и разделы Word</summary><div className="overflow-auto"><table className="text-xs w-full"><thead><tr><th className="text-left p-2">График / пункт Word</th><th>Состояние</th><th>Панелей</th><th>Строк</th></tr></thead><tbody>{coverage.map(r=><tr key={r.key}><td className="p-2">{r.label}</td><td>{r.status}</td><td>{r.ready.length}</td><td>{r.rows}</td></tr>)}</tbody></table></div></details>
 </CardContent></Card>;
}
