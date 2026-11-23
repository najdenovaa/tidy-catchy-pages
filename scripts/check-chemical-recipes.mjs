import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.goto('http://127.0.0.1:8080/cementing/program');
await page.evaluate(async()=>{
 const f=await import('/src/lib/__tests__/fixtures/optimizer-cleaning-fixture.ts');
 sessionStorage.setItem('cementing_session_v1',JSON.stringify(f.qualityInput()));
});
await page.reload();await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.getByRole('button',{name:/^Автоподбор/}).click();
const optimizer=page.locator('[data-tab-content="optimizer"]'),recipe=optimizer.getByTestId('chemical-wash-recipes'),comparison=optimizer.getByTestId('optimizer-comparison');
const applyBest=async()=>{
 const before=await page.evaluate(()=>sessionStorage.getItem('cementing_session_v1'));
 await comparison.getByRole('button',{name:'Применить',exact:true}).first().click();
 await page.waitForFunction(old=>sessionStorage.getItem('cementing_session_v1')!==old,before,{timeout:30000});
};
await recipe.locator('summary').first().click();
await recipe.getByLabel('Основа БР для подбора химии',{exact:true}).selectOption('oil');
await recipe.getByLabel('Стартовая рецептура химбуфера',{exact:true}).selectOption('obm-mes-solvent');
await recipe.getByRole('button',{name:'Внести химическую рецептуру',exact:true}).click();
assert.equal(await recipe.getByLabel('PV химбуфера, сПз',{exact:true}).inputValue(),'20');
await recipe.getByText('Лабораторные сведения (необязательно)').click();
for(const [label,value] of [['Плотность химбуфера, кг/м³','1100'],['PV химбуфера, сПз','20'],['YP химбуфера, Па','5'],['Температура химбуфера, °C','40'],['Давление химбуфера, МПа абс.','5'],['Вода химбуфера и минерализация','CI: контрольная вода 0,2 г/л'],['Протокол замеров свойств химбуфера','CI: синтетический контроль свойств']])await recipe.getByLabel(label,{exact:true}).fill(value);
await recipe.getByRole('button',{name:'Подтвердить замеры химбуфера',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').buffers?.[0]?.chemicalRecipe?.propertySignature,{},{timeout:15000});
mkdirSync('/tmp/chemical-recipes',{recursive:true});
for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});await recipe.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/chemical-recipes/${width}.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Page overflow');
}
await page.evaluate(async()=>{
 const s=JSON.parse(sessionStorage.getItem('cementing_session_v1'));
 const {labFluids}=await import('/src/lib/fluid-interaction-lab.ts'),f=labFluids(s);
 // Disposable CI data: never a real laboratory result or a literature-to-project transfer.
 s.wellData.fluidInteractionLab={version:1,temperatureC:40,pressureMPaAbs:5,useMixtures:false,mixtures:[],removal:[{id:'CI-REMOVAL',source:'CI: синтетический протокол смытия',temperatureC:40,pressureMPaAbs:5,cleanerId:'buffer:0',cleanerKey:f[1].key,mudKey:f[0].key,fromMD:0,toMD:600,criticalPa:.01,exposureS:60,removalPct:91,notes:'Проверка программы'}]};
 sessionStorage.setItem('cementing_session_v1',JSON.stringify(s));
});
await page.reload();await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.getByRole('button',{name:/^Автоподбор/}).click();
for(const [label,value] of [['Мин. расход, л/с','30'],['Макс. расход продавки, л/с','30'],['Макс. расход затворения, л/с','30'],['Шаг, л/с','10'],['Предел на устье, МПа','100'],['Запас до ГРП, МПа','0']])await optimizer.getByLabel(label,{exact:true}).fill(value);

await optimizer.getByRole('button',{name:'Подобрать программу',exact:true}).click();
const card=optimizer.getByTestId('complete-program-details');
await comparison.getByRole('button',{name:'Применить',exact:true}).first().waitFor({timeout:180000});
assert.ok((await card.textContent()).includes('Турбулизатор:'));
await applyBest();
await page.waitForFunction(()=>document.querySelector('[data-tab-content="optimizer"]')?.textContent?.includes('Вариант «Лучшее качество» записан'),{},{timeout:15000});
const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.equal(saved.drillingFluid.base,'oil');
assert.equal(saved.buffers[0].chemicalRecipe.id,'obm-mes-solvent');
assert.deepEqual(saved.buffers[0].additives.map(x=>x.percentage),[.05,.5,2]);
// No recipe, no laboratory data: a single click must prepare usable planning buffers.
await page.evaluate(async()=>{
 const {qualityInput}=await import('/src/lib/__tests__/fixtures/optimizer-cleaning-fixture.ts');
 const s=qualityInput();s.buffers=[];sessionStorage.setItem('cementing_session_v1',JSON.stringify(s));
});
await page.reload();await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.getByRole('button',{name:/^Автоподбор/}).click();
const configure=async()=>{
 for(const [label,value] of [['Мин. расход, л/с','30'],['Макс. расход продавки, л/с','30'],['Макс. расход затворения, л/с','30'],['Шаг, л/с','10'],['Предел на устье, МПа','100'],['Запас до ГРП, МПа','0']])await optimizer.getByLabel(label,{exact:true}).fill(value);

};
await configure();await optimizer.getByRole('button',{name:'Подобрать программу',exact:true}).click();
await comparison.getByRole('button',{name:'Применить',exact:true}).first().waitFor({timeout:180000});
assert.ok((await card.textContent()).includes('Целевая зона'));
assert.ok((await card.textContent()).includes('CQI'));
await applyBest();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').buffers?.length===2,{},{timeout:15000});
const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.equal(draft.wellData.optimizerCleaning?.proof,undefined);
assert.deepEqual(draft.buffers.map(b=>b.bufferType),['chemical_wash','weighted']);
await page.screenshot({path:'/tmp/chemical-recipes/planning-mobile.png'});
// Previously saved zero-PV chemical recipe; unchecked selection must never demand water/protocol.
await page.evaluate(async()=>{
 const {qualityInput}=await import('/src/lib/__tests__/fixtures/optimizer-cleaning-fixture.ts');
 const {applyChemicalRecipe,WASH_RECIPES}=await import('/src/lib/chemical-wash-recipes.ts');
 const s=qualityInput();s.drillingFluid.base='oil';
 s.buffers[0]=applyChemicalRecipe(s.buffers[0],WASH_RECIPES.find(r=>r.id==='obm-mes-solvent'),{},s.drillingFluid);
 s.buffers[0].rheology={pv:0,yp:0,model:'pvyp'};
 s.buffers[0].volume=8;s.buffers[0].flowRateSteps[0].volumeM3=8;s.buffers[1].volume=12;s.buffers[1].flowRateSteps[0].volumeM3=12;
 sessionStorage.setItem('cementing_session_v1',JSON.stringify(s));
});
await page.reload();await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.getByRole('button',{name:/^Автоподбор/}).click();await configure();
await optimizer.getByLabel('Усилить качество подбором буферов',{exact:true}).uncheck();
await optimizer.getByRole('button',{name:'Подобрать программу',exact:true}).click();
await comparison.getByRole('button',{name:'Применить',exact:true}).first().waitFor({timeout:180000});
assert.equal(await optimizer.getByTestId('quality-cleaning-plan').count(),0);
assert.equal(await optimizer.getByTestId('chemical-wash-recipes').count(),0);
await applyBest();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').buffers?.[0]?.rheology?.pv===20,{},{timeout:15000});
const unchanged=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.equal(unchanged.buffers.length,2);assert.deepEqual(unchanged.buffers.map(b=>b.volume),[8,12]);assert.ok(unchanged.wellData.optimizerProgram.hardware.length>=2);assert.equal(unchanged.buffers[0].density,1100);
assert.deepEqual(unchanged.buffers[0].additives.map(a=>a.percentage),[.05,.5,2]);
assert.equal(unchanged.wellData.optimizerCleaning,undefined);
assert.equal(await comparison.locator('thead th').filter({hasText:'Лучшее качество'}).count(),1);
await page.screenshot({path:'/tmp/chemical-recipes/buffer-disabled-mobile.png'});
assert.equal(errors.length,0,errors.join('; '));
console.log('CHEMICAL_RECIPES_OK: family, component recipe, new measurements, own removal evidence, native optimizer, application, desktop/mobile, planning defaults without laboratory, unchecked buffer bypass, legacy zero-PV recovery');
await browser.close();
