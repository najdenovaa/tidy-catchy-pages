import type { LogisticsSettings } from './cement-logistics';
export type FleetScheme = 'classic' | 'twin' | 'single' | 'mixer-ca';
export const FLEET_SCHEMES: Record<FleetScheme,string> = {
  classic:'Классика: ЦА + СМН', twin:'Двухнасосный агрегат + ЦТ-25', single:'Однонасосные агрегаты + ЦТ-25', 'mixer-ca':'Миксер + ЦА + ЦТ-25',
};
export const FLEET_MANUFACTURERS=['SERVA','Jereh','Halliburton Elite','Stewart & Stevenson','Хант (РФ)','Стромнефтемаш (УНБС)','Другая / свой парк'];
/** Published specifications are reference limits, not a simultaneous Q-P duty point. */
export const FLEET_SOURCES=[
 {name:'SERVA / SJS PCT-521A, TPH400',url:'https://en.sjs.servacorp.com/products_detail/1.html',note:'Два двигателя 540 HP; TPH400 4 дюйма: предел 103,4 МПа, подача до 1,2 м³/мин на насос; ACM до 2,3 м³/мин. Максимумы Q и P не одновременны.'},
 {name:'Jereh Single / Twin Pump',url:'https://www.jereh-pe.com/en/products/cementing-fleet/twin-pump-cementing-unit',note:'JR600N: пределы зависят от плунжера; AMS до 2,3 м³/мин. Данные по Q-P и доступной мощности уточняются для конкретного исполнения.'},
 {name:'ЦТ-25, Сибнефтемаш',url:'https://www.sibneftemash.ru/pdf-catalog/catalog19.06.2019.pdf',note:'Объём 25 м³, грузоподъёмность до 30 т, пневмовыгрузка до 1,1 т/мин. Масса ограничена также насыпной плотностью и дорожными условиями.'},
 {name:'УНБ / УНБ2 ЦК',url:'https://rimera.ru/products/burenie-stroitelstvo-i-remont-skvazhin/tsementirovochnyy-kompleks-i-spetstekhnika-dlya-tsementirovaniya-pri-stroitelstve-skvazhin/tsementirovochnyy-kompleks/',note:'Одно- и двухнасосные комплексы, смешивание до 2,3 м³/мин; исполнение и характеристика насоса задаются по паспорту.'},
];
/** Values marked as design assumptions remain editable; a brand never certifies a pump curve. */
export function fleetTemplate(scheme: FleetScheme, old: LogisticsSettings): LogisticsSettings {
  if(scheme==='classic') return {...old,scheme,unitName:'ЦА-320',unitPowerKW:100,unitMaxPressureMPa:32,unitMaxRateLps:23,mixerName:'СМН-20',mixerCapacityT:20,mixRatePerPairLps:12,pumpsPerUnit:1,pumpCurve:undefined,passportConfirmed:false};
  return {...old,scheme,unitName:scheme==='mixer-ca'?'ЦА-320':'Агрегат по паспорту',manufacturer:scheme==='mixer-ca'?'Другая / свой парк':old.manufacturer||'SERVA',
    unitPowerKW:scheme==='mixer-ca'?100:scheme==='twin'?600:300,unitMaxPressureMPa:scheme==='mixer-ca'?32:70,unitMaxRateLps:scheme==='mixer-ca'?23:scheme==='twin'?50:25,pumpsPerUnit:scheme==='twin'?2:1,
    mixerName:scheme==='mixer-ca'?'Автономный рециркуляционный миксер':'Встроенный рециркуляционный смеситель',mixRatePerPairLps:30,
    pumpCurve:undefined,passportConfirmed:false,bulkVolumeM3:25,bulkPayloadT:30,bulkDensityTm3:1.2,bulkUnloadTmin:1.1,maxBulkConnections:2,closedMixing:true};
}
