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
const optimizer=page.locator('[data-tab-content="optimizer"]'),recipe=optimizer.getByTestId('chemical-wash-recipes');
await recipe.locator('summary').click();
await recipe.getByLabel('Основа БР для подбора химии',{exact:true}).selectOption('oil');
await recipe.getByLabel('Стартовая рецептура химбуфера',{exact:true}).selectOption('obm-mes-solvent');
await recipe.getByRole('button',{name:'Внести химическую рецептуру',exact:true}).click();
assert.equal(await recipe.getByLabel('Измеренный PV химбуфера, сПз',{exact:true}).inputValue(),'0');
for(const [label,value] of [['Измеренная плотность химбуфера, кг/м³','1100'],['Измеренный PV химбуфера, сПз','20'],['Измеренный YP химбуфера, Па','5'],['T замеров химбуфера, °C','40'],['P замеров химбуфера, МПа абс.','5'],['Вода химбуфера и минерализация','CI: контрольная вода 0,2 г/л'],['Протокол замеров свойств химбуфера','CI: синтетический контроль свойств']])await recipe.getByLabel(label,{exact:true}).fill(value);
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
await optimizer.getByLabel('Подбирать центрирование',{exact:true}).uncheck();
await optimizer.getByRole('button',{name:'Подобрать программу',exact:true}).click();
const card=optimizer.getByTestId('quality-cleaning-plan');
await page.waitForFunction(()=>{const button=document.querySelector('[data-testid="quality-cleaning-plan"] button');return !!button&&!button.disabled;},{},{timeout:120000});
assert.ok((await card.textContent()).includes('91%'));
await card.getByRole('button',{name:'Применить высокое качество',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')??'{}').wellData?.optimizerCleaning?.proof?.removalPct===91,{},{timeout:15000});
const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cementing_session_v1')));
assert.equal(saved.drillingFluid.base,'oil');
assert.equal(saved.buffers[0].chemicalRecipe.id,'obm-mes-solvent');
assert.deepEqual(saved.buffers[0].additives.map(x=>x.percentage),[.05,.5,2]);
assert.equal(errors.length,0,errors.join('; '));
console.log('CHEMICAL_RECIPES_OK: family, component recipe, new measurements, own removal evidence, native optimizer, application, desktop/mobile');
await browser.close();
