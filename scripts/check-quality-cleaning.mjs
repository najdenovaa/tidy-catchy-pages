import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.goto('http://127.0.0.1:8080/cementing/program');
const seed=async()=>{
 await page.evaluate(async()=>{
  const {qualityInput}=await import('/src/lib/__tests__/fixtures/optimizer-cleaning-fixture.ts');
  sessionStorage.setItem('cementing_session_v1',JSON.stringify(qualityInput()));
 });
 await page.reload();await page.locator('[data-cementing-program]').waitFor();
 await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
 await page.getByRole('button',{name:/^Автоподбор/}).click();
};
const panel=page.locator('[data-tab-content="optimizer"]'),comparison=panel.getByTestId('optimizer-comparison');
const run=async()=>{
 for(const [label,value] of [['Мин. расход, л/с','30'],['Макс. расход продавки, л/с','30'],['Макс. расход затворения, л/с','30'],['Шаг, л/с','10'],['Предел на устье, МПа','100'],['Запас до ГРП, МПа','0']])await panel.getByLabel(label,{exact:true}).fill(value);
 await panel.getByRole('button',{name:'Подобрать программу',exact:true}).click();
 await comparison.getByRole('button',{name:'Применить',exact:true}).first().waitFor({timeout:180000});
};
const read=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
await seed();await run();
assert.equal(await comparison.locator('thead th').filter({hasText:'Лучшее качество'}).count(),1);
assert.equal((await panel.textContent()).includes('Лучшее вытеснение'),false);
assert.ok((await panel.textContent()).includes('Качество цементирования CQI'));
const details=panel.getByTestId('complete-program-details');await details.locator('summary').first().click();
assert.ok((await details.textContent()).includes('Турбулизатор:'));
mkdirSync('/tmp/quality-cleaning',{recursive:true});
for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});await comparison.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/quality-cleaning/${width}.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Page overflow');
}
const apply=comparison.getByRole('button',{name:'Применить',exact:true}),count=await apply.count();
assert.ok(count>=1);
await apply.first().click();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').wellData?.optimizerProgram?.variant==='Лучшее качество',{},{timeout:30000});
const saved=await read(),record=saved.wellData.optimizerProgram;
assert.ok(record.hardware.some(h=>h.kind==='centralizer'&&h.quantity>0));
assert.ok(record.hardware.some(h=>h.kind==='turbulator'&&h.quantity>0));
assert.ok(record.transit.every(t=>t.coveredDepths===t.totalDepths&&t.minContactMin>0));
assert.equal(record.transit[0].minRateLps,10);
assert.ok(saved.wellData.centralizerDesign.intervals.every(iv=>iv.spec.libraryReference));
assert.ok(saved.wellData.turbulatorDesign.points.every(p=>p.catalog?.model));
assert.ok(saved.slurries.some(s=>s.flowRateSteps.some(x=>x.rateLps===10)));
await page.reload();await page.locator('[data-cementing-program]').waitFor();
// Give the center module's report effects time to publish, then compare immutable placement.
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').wellData?.centralizerDesign?.intervals?.length>0);
const persisted=await read();
assert.deepEqual(persisted.buffers,saved.buffers);
assert.deepEqual(persisted.wellData.centralizerDesign,saved.wellData.centralizerDesign);
assert.deepEqual(persisted.wellData.turbulatorDesign,saved.wellData.turbulatorDesign);
assert.deepEqual(persisted.wellData.optimizerProgram,record);
// A different comparison column must also apply its own complete program.
if(count>1){
 await seed();await run();
 const headers=await comparison.locator('thead th').allTextContents(),label=headers[headers.length-1].split('\n')[0].trim();
 await comparison.getByRole('button',{name:'Применить',exact:true}).last().click();
 await page.waitForFunction(()=>!!JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').wellData?.optimizerProgram,{},{timeout:30000});
 const other=await read();assert.notEqual(other.wellData.optimizerProgram.variant,'Лучшее качество');
 assert.ok(other.wellData.optimizerProgram.hardware.length>=2);assert.ok(other.wellData.turbulatorDesign.points.length>0);
 assert.ok(label);
}
assert.equal(errors.length,0,errors.join('; '));
console.log('QUALITY_CLEANING_OK: complete CQI variants, interval buffer transit, catalogue hardware, atomic application, persistence, desktop/mobile');
await browser.close();
