import {qualityInput} from './optimizer-cleaning-fixture';
import {emptyEquipmentLibrary,saveEquipmentRevision} from '../../equipment-library';
import {optimizerHardwareCatalog} from '../../optimizer-hardware';
export function turnkeyFixture(){
 const input=qualityInput();
 // Synthetic test geometry, never a manufacturer product or a field passport.
 const library=saveEquipmentRevision(emptyEquipmentLibrary(),{kind:'turbulator',model:'CI-168 · испытательная геометрия',manufacturer:'Синтетический стенд CI',casingOD:168,outerDiameter:184,passageID:172,bladesCount:4,bladeAngle:45,bladeHeight:8,lengthMm:180,bladeWidthMm:8,sleeveThicknessMm:2},{source:'CI: синтетическая геометрия для проверки программы',basis:'user',notes:'Не промысловые данные'});
 return {input,library,catalog:optimizerHardwareCatalog(library)};
}
