import {describe,it,expect} from 'vitest';
import {parseLas,parseSurveyText,buildSurvey,surveyColumns,buildCaliper,aggregateCaliperIntervals,decodeSurveyText} from './well-survey-import';
import {annularVolumeForInterval,openHoleVolumeForInterval} from './cementing-calculations';
const las=(data='0 200\n1 200\n2 200',wrap='NO',units='M',diam='MM')=>`~Version\nVERS. 2.0 : version\nWRAP. ${wrap} : wrap\n~Well\nNULL. -999.25 : null\n~Curve\nDEPT.${units} : depth\nCALI.${diam} : diameter\n~ASCII\n${data}`;
const opts={depthColumn:0,diameterColumn:1,depthUnit:'m' as const,diameterUnit:'mm' as const,nominalDiameterMm:200,topMD:0,bottomMD:100,maxGapM:2};
describe('LAS 2.0 caliper import',()=>{
 it('reads WRAP NO/YES in the declared curve order and handles nulls',()=>{
  expect(parseLas(las()).rows).toEqual([[0,200],[1,200],[2,200]]);
  expect(parseLas(las('0\n200\n1\n-999.25','YES')).rows).toEqual([[0,200],[1,null]]);
 });
 it('rejects ambiguous/corrupt layouts instead of shifting columns',()=>{
  expect(()=>parseLas(las('0 200 300'))).toThrow(/значений/);
  expect(()=>parseLas(las('0\n200\n1','YES'))).toThrow(/неполная/);
  expect(()=>parseLas(las('0 abc'))).toThrow(/числовые/);
  expect(()=>parseLas(las().replace('2.0','3.0'))).toThrow(/LAS 2.0/);
  expect(()=>parseLas(las().replace('NULL. -999.25 : null',''))).toThrow(/NULL/);
  expect(()=>parseLas(las()+'\n~ASCII\n0 200')).toThrow(/повторный/);
 });
 it('converts feet/inches and never stretches the final sample to the bottom',()=>{
  const p=buildCaliper(parseLas(las('0 8\n10 8','NO','FT','IN')),{...opts,depthUnit:'ft',diameterUnit:'in',maxGapM:4});
  expect(p.coveredM).toBeCloseTo(3.048,8);expect(p.intervals.at(-1)?.toMD).toBeCloseTo(3.048,8);
  expect(p.minDiameterMm).toBeCloseTo(203.2,8);expect(p.intervals[0].coeff).toBeCloseTo((203.2/200)**2,8);
 });
 it('keeps NULL gaps and large sampling gaps uncovered',()=>{
  const p=buildCaliper(parseLas(las('0 200\n1 200\n2 -999.25\n3 200\n10 200\n11 200')),opts);
  expect(p.intervals).toEqual([{fromMD:0,toMD:1,coeff:1},{fromMD:10,toMD:11,coeff:1}]);
  expect(p.missingPairs).toBe(3);expect(p.coveredM).toBe(2);
 });
 it('clips at the previous shoe and well bottom and integrates mean area',()=>{
  const p=buildCaliper(parseLas(las('0 200\n10 400')),{...opts,topMD:2,bottomMD:8,maxGapM:10});
  // d² interpolates 40000..160000; mean over 2..8 is 100000 mm².
  expect(p.intervals[0]).toEqual({fromMD:2,toMD:8,coeff:2.5});
  expect(openHoleVolumeForInterval(2,8,200,1,p.intervals)).toBeCloseTo(Math.PI/4*.1*6,10);
  expect(annularVolumeForInterval(2,8,200,100,250,0,1,p.intervals)).toBeCloseTo(Math.PI/4*(.1-.01)*6,10);
 });
 it('area-preserving aggregation does not bridge unmeasured gaps',()=>{
  const input=[{fromMD:0,toMD:1,coeff:1},{fromMD:1,toMD:2,coeff:3},{fromMD:3,toMD:4,coeff:2}];
  const grouped=aggregateCaliperIntervals(input,5);
  expect(grouped).toEqual([{fromMD:0,toMD:2,coeff:2},{fromMD:3,toMD:4,coeff:2}]);
  expect(openHoleVolumeForInterval(0,5,200,1,grouped)).toBeCloseTo(openHoleVolumeForInterval(0,5,200,1,input),10);
 });
 it('sorts descending depth, rejects duplicate MD, and preserves constrictions',()=>{
  expect(buildCaliper(parseLas(las('2 180\n1 180\n0 180')),opts).intervals[0].coeff).toBeCloseTo(.81,9);
  expect(()=>buildCaliper(parseLas(las('0 200\n0 200')),opts)).toThrow(/повторяются/);
  expect(()=>buildCaliper(parseLas(las()),{...opts,diameterColumn:0})).toThrow(/разные/);
  expect(()=>buildCaliper(parseLas(las()),{...opts,nominalDiameterMm:0})).toThrow(/диаметр/);
 });
});
describe('TXT survey import',()=>{
 it('maps reordered headers and decimal commas in semicolon files',()=>{
  const t=parseSurveyText('Azimuth;MD [m];Inclination\n0;0;0\n90;100,5;30');
  expect(surveyColumns(t)).toEqual({md:1,azimuth:0,zenith:2});
  const p=buildSurvey(t,surveyColumns(t),'m','deg');expect(p.points[1].md).toBe(100.5);
  // Minimum curvature for inclination changing linearly 0..30 degrees.
  expect(p.points[1].tvd).toBeCloseTo(100.5*Math.sin(Math.PI/6)/(Math.PI/6),1);
 });
 it('reads quoted CSV fields with comma delimiters and spaces',()=>{
  const t=parseSurveyText('"MD [m]", "AZI", "INC"\n"0", "0", "0"\n"10", "90", "0"');
  expect(buildSurvey(t,surveyColumns(t),'m','deg').points[1]).toMatchObject({md:10,azimuth:90,tvd:10});
 });
 it('converts feet and radians and requires explicit mapping without headers',()=>{
  const t=parseSurveyText('0\t0\t0\n100\t0\t0');
  expect(surveyColumns(t).md).toBe(-1);expect(t.warnings.length).toBe(1);
  expect(buildSurvey(t,{md:0,azimuth:1,zenith:2},'ft','rad').points[1].tvd).toBe(30.48);
 });
 it('supports degrees and radians independently for the two angle columns',()=>{
  const t=parseSurveyText('MD [m];AZI [deg];INC [rad]\n0;90;0\n10;90;'+Math.PI/6);
  const r=buildSurvey(t,surveyColumns(t),'m','rad','deg');
  expect(r.points[1].azimuth).toBe(90);expect(r.points[1].zenith).toBeCloseTo(30,9);
 });
 it('rejects unknown tie-in, duplicate depths, missing values and out-of-range angles',()=>{
  const run=(s:string)=>buildSurvey(parseSurveyText('MD;AZ;INC\n'+s),{md:0,azimuth:1,zenith:2},'m','deg');
  expect(()=>run('10;0;0\n20;0;0')).toThrow(/MD=0/);
  expect(()=>run('0;0;0\n0;0;0')).toThrow(/Повторяются/);
  expect(()=>run('0;0;0\n1;;0')).toThrow(/пропуск/);
  expect(()=>run('0;0;0\n1;0;181')).toThrow(/180/);
  expect(()=>parseSurveyText('MD;AZ;INC\n0;0;0\n1;0')).toThrow(/колонок/);
 });
 it('decodes UTF-8/UTF-16 and Windows-1251 without uploading',()=>{
  expect(decodeSurveyText(new TextEncoder().encode('Глубина').buffer)).toBe('Глубина');
  expect(decodeSurveyText(new Uint8Array([255,254,77,0,68,0]).buffer)).toBe('MD');
  expect(decodeSurveyText(new Uint8Array([0xc3,0xeb,0xf3,0xe1,0xe8,0xed,0xe0]).buffer)).toBe('Глубина');
 });
});
