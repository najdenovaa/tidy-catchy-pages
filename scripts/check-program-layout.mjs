import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.LAYOUT_QA_DIR??'/tmp/program-layout';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',d=>d.accept()); // This is the disposable documented example, never a user project.
await page.goto('http://127.0.0.1:8080/cementing/program');
await page.locator('[data-cementing-program]').waitFor();
await page.getByRole('button',{name:'Загрузить пример',exact:true}).click();
await page.getByRole('button',{name:'РАСЧЁТ',exact:true}).click();
await page.locator('[data-tab-content="charts"] .program-additional').waitFor({state:'attached',timeout:60000});
const groups=[
 ['Ввод',[['input','Данные'],['centralization','Центрация (со спуском)'],['foam','Пена'],['rotation','Вращение'],['woc','ОЗЦ']]],
 ['Анализ',[['charts','Графики'],['trajectory','Траектория'],['hydraulics','Гидравлика'],['schedule','Закачка'],['materials','Материалы'],['lab','Лаборатория и рецептура'],['norms','Нормы и риски'],['logistics','Техника'],['contact','Контакт'],['quality','Качество (CQI)'],['skc','Контроль СКЦ'],['torquedrag','T&D'],['drillhydr','Гидравлика бурения']]],
 ['Визуализация',[['animation','Анимация'],['displace3d','Вытеснение 3D'],['visual','Визуализация']]],
 ['Автоподбор',[['optimizer','Автоподбор программы']]],
];
const records=[];
for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});
 for(const[group,tabs]of groups){
  await page.getByRole('button',{name:new RegExp('^'+group)}).click();
  for(const[id,label]of tabs){
   if(id!=='optimizer')await page.getByRole('tab',{name:label,exact:true}).click();
   const panel=page.locator(`[data-tab-content="${id}"]`);await panel.waitFor({state:'visible'});await page.keyboard.press('Control+Home');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const metrics=await panel.evaluate(el=>{
    const headers=[...el.querySelectorAll('summary,.program-section-trigger')].filter(e=>e.getClientRects().length);
    return {font:getComputedStyle(el).fontFamily,headers:headers.map(e=>{const s=getComputedStyle(e);return {text:e.textContent.slice(0,100),font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,padding:s.padding,background:s.backgroundColor};}),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,overflow:[...el.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2&&!e.closest('.overflow-x-auto,.overflow-auto,.overflow-hidden');}).slice(0,15).map(e=>({tag:e.tagName,classes:e.className?.toString().slice(0,180),text:e.textContent?.slice(0,90)})),additional:[...el.querySelectorAll('.program-additional')].map(e=>({title:e.querySelector('h3')?.textContent,closed:[...e.querySelectorAll(':scope > details')].every(d=>!d.open)}))};
   });
   if(metrics.headers.some(h=>h.size!=='14px'||h.weight!=='500'||h.padding!=='12px 16px'))errors.push(`${width}/${id}: inconsistent disclosure header ${JSON.stringify(metrics.headers)}`);
   if(metrics.pageWidth>width+2)errors.push(`${width}/${id}: page overflow ${metrics.pageWidth}`);
   if(metrics.additional.some(a=>!a.closed))errors.push(`${width}/${id}: expanded additional panel`);
   records.push({width,id,...metrics});
   await page.screenshot({path:`${out}/${width}-${id}.png`});
   if(['charts','hydraulics','lab'].includes(id)){
    // Verify the additional controls follow all primary content in DOM order.
    const order=await panel.evaluate(el=>{const extra=el.querySelector(':scope > .program-additional')??el.querySelector(':scope > div > .program-additional');return extra?[...extra.parentElement.children].map(e=>e===extra?'additional':'primary'):[];});
    if(order.at(-1)!=='additional'||order.slice(0,-1).includes('additional'))errors.push(`${id}: primary/additional order`);
    await panel.locator('.program-additional').last().scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/${width}-${id}-additional.png`});
    const summaries=panel.locator('.program-panel > summary');
    for(let j=0;j<await summaries.count();j++){
      const summary=summaries.nth(j);await summary.click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.screenshot({path:`${out}/${width}-${id}-expanded-${j}.png`});
      const expandedWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
      if(expandedWidth>width+2)errors.push(`${width}/${id}: expanded panel ${j} overflow ${expandedWidth}`);
      await summary.click();
    }
   }
  }
 }
}
writeFileSync(`${out}/audit.json`,JSON.stringify({records,errors},null,2));
if(errors.length)throw Error('Page errors: '+errors.join('; '));
console.log(`PROGRAM_LAYOUT_OK ${records.length} tab/viewport checks; additional panels closed; primary content first`);
await browser.close();
