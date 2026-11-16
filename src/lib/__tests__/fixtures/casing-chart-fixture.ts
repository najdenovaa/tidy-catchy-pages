import {getCementingExample} from '../../cementing-example';
import {normalizeDepthChartSettings} from '../../depth-chart-settings';
import {resolveCentralizationReport} from '../../cementing-report-data';
import {normalizeRunningSettings} from '../../casing-running-analysis';
export const well={...getCementingExample().wellData,casingDepthMD:200,wellDepthMD:200,wellDepthTVD:100,prevCasingDepth:0,holeDiameter:230,cavernCoeff:1,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:100,tvd:100,zenith:90,azimuth:20},{md:200,tvd:100,zenith:90,azimuth:20}],runningSettings:normalizeRunningSettings({measurements:[{md:150,hookTF:0,mode:'runIn'},{md:250,hookTF:1,mode:'pullOut'}],maxHookKN:150})};
export const data=resolveCentralizationReport({mode:'manual',calculated:true,intervals:[{id:'i',fromMD:0,toMD:200,jointLength:12,centralizersPerJoint:1,spec:{type:'spring',bladesCount:6,bladeHeight:35,restoringForce:5,maxAxialLoad:0,passport:{model:'Тест А',manufacturer:'Завод',note:'SECRET-PASSPORT'}}}],results:[],turbPoints:[],running:{mudDensity:1100,pv:15,yp:5,frictionCased:.25,frictionOpenhole:.35},chartSettings:{...normalizeDepthChartSettings({}),coordinate:'TVD',depthUnit:'ft'}},well,1100)!;
