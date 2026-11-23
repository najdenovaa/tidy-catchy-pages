import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.goto('http://127.0.0.1:8080/cementing/program');
await page.evaluate(async()=>{
 const f=await import('/src/lib/__tests__/fixtures/optimizer-cleaning-fixture.ts');
 sessionStorage.setItem('cementing_session_v1',JSON.stringify(f.withQualityProof(f.qualityInput())));
});
await page.reload();await page.locator('[data-cementing-program]').waitFor();
await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.getByRole('button',{name:/^Автоподбор/}).click();
const panel=page.locator('[data-tab-content="optimizer"]');
for(const [label,value] of [['Мин. расход, л/с','10'],['Макс. расход продавки, л/с','30'],['Макс. расход затворения, л/с','30'],['Шаг, л/с','10'],['Предел на устье, МПа','100'],['Запас до ГРП, МПа','0']])await panel.getByLabel(label,{exact:true}).fill(value);
await panel.getByLabel('Подбирать центрирование',{exact:true}).uncheck();
await panel.getByRole('button',{name:'Подобрать программу',exact:true}).click();
const card=panel.getByTestId('quality-cleaning-plan'),apply=panel.getByRole('button',{name:'Применить',exact:true}).first();
await apply.waitFor({timeout:120000});
assert.equal(await panel.getByRole('columnheader').filter({hasText:'Лучшее качество'}).count(),1);
assert.equal((await panel.textContent()).includes('Лучшее вытеснение'),false);
assert.ok((await panel.textContent()).includes('Качество цементирования CQI'));
const enhanced=(await panel.getByTestId('buffer-boost-details').textContent()).includes('Усиление включено');
assert.ok((await card.textContent()).includes('Измеренное смытие'));
assert.equal(await card.getByRole('button').count(),0,'Only the main result applies a program');
mkdirSync('/tmp/quality-cleaning',{recursive:true});
for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});await panel.getByRole('columnheader').filter({hasText:'Лучшее качество'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/quality-cleaning/${width}.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Page overflow');
}
await apply.click();
await page.waitForFunction(()=>document.querySelector('[data-tab-content="optimizer"]')?.textContent?.includes('Вариант «Лучшее качество» записан'),{},{timeout:30000});
const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.equal(saved.buffers[0].bufferType,'chemical_wash');assert.equal(saved.buffers[1].bufferType,'weighted');
if(enhanced){
 assert.ok(saved.wellData.turbulatorDesign.points.length>1);
 assert.equal(saved.wellData.centralizerDesign.targetStandoff,85);
 assert.equal(saved.wellData.optimizerCleaning.proof.removalPct,86);
 assert.ok(saved.slurries.some(s=>s.flowRateSteps.some(x=>x.rateLps===10)));
}else assert.equal(saved.wellData.optimizerCleaning,undefined);
await page.reload();
const persisted=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.deepEqual(persisted.buffers,saved.buffers);
assert.deepEqual(persisted.wellData.optimizerCleaning,saved.wellData.optimizerCleaning);
assert.equal(errors.length,0,errors.join('; '));
console.log('QUALITY_CLEANING_OK: CQI objective, displacement as a separate metric, optional boost, one main apply action, persistence, desktop/mobile');
await browser.close();
