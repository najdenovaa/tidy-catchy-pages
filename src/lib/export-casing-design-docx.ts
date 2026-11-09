import { Document,Packer,Paragraph,TextRun,HeadingLevel,Header,AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { reportPageProperties } from './report-layout';
import type { WellData } from './cementing-calculations';
import { resolveCentralizationReport,type CentralizationReportData,type ReportFigure } from './cementing-report-data';
import { buildCementingReportExtras } from './cementing-report-sections';
import { buildCementingReportSvgs,buildWellReportSvgs,rasterizeReportSvgs } from './cementing-report-figures';
import { allowedReportFigure,missingReportFigures,REPORT_SCOPE_TITLES,type ReportScope,type ReportSelection } from './cementing-report-options';
export async function exportCasingDesignDocx(w:WellData,data:CentralizationReportData,mudDensity:number,scope:Exclude<ReportScope,'cementing'>,selection?:ReportSelection,options:{returnBlob?:boolean;figures?:ReportFigure[]}={}) {
 const current=resolveCentralizationReport(data,w,mudDensity);
 if(!current)throw new Error('Сначала выполните актуальный расчёт центрирования.');
 const extras={centralization:current,figures:options.figures,warnings:[] as string[]};
 if(!extras.figures&&typeof window!=='undefined'){
   const svgs=[...buildCementingReportSvgs(w,extras,scope,selection),...buildWellReportSvgs(w,[]).filter(x=>allowedReportFigure(scope,selection,x))];
   extras.warnings.push(...missingReportFigures(scope,selection,svgs));
   extras.figures=await rasterizeReportSvgs(svgs);
 }
 const content=buildCementingReportExtras(w,extras,scope,selection);
 const doc=new Document({styles:{default:{document:{run:{font:'Calibri',size:20}}}},sections:[{properties:reportPageProperties(),headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:REPORT_SCOPE_TITLES[scope],size:16,color:'64748b'})]})]})},children:[new Paragraph({text:REPORT_SCOPE_TITLES[scope],heading:HeadingLevel.TITLE}),new Paragraph({text:`Колонна ${w.casingOD} × ${w.casingWall} мм, башмак MD ${w.casingDepthMD} м. ${new Date().toLocaleDateString('ru-RU')}`}),...content]}]});
 const blob=await Packer.toBlob(doc);if(options.returnBlob)return blob;
 saveAs(blob,scope==='centralization'?'Расчёт-центрирования.docx':'Расчёт-дохождения-колонны.docx');
}
