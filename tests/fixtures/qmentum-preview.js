// LOCAL SYNTHETIC PREVIEW. No Firebase import, session, credential or network data.
import '../../src/styles.css';
import {renderQmentumShell} from '../../src/qmentum-shell.js';
import {mountQmentumModule} from '../../src/qmentum-ui.js';
import {initialDefinitions,emptyInputs} from '../../src/qmentum-catalog.js';
import {calculateMonth} from '../../src/qmentum-engine.js';
import {transitionMonth} from '../../src/qmentum-data.js';
const definitions=initialDefinitions();Object.values(definitions.items).forEach(d=>{d.approved=true;d.criterion='Critério apenas sintético para demonstração local';});
const rows=[],histories=new Map(),defMap=new Map([[1,definitions]]),now=new Date();
const units=[{unitId:'synthetic-unit',name:'Unidade sintética — teste local',active:true},{unitId:'synthetic-other',name:'Outra unidade sintética',active:true}];
const clone=structuredClone;
const repository={open:async()=>({access:{role:'manager'},units,definitions:clone(definitions)}),year:async(unitId,year)=>clone(rows.filter(r=>r.unitId===unitId&&r.year===year)),month:async(unitId,year,month)=>clone(rows.find(r=>r.unitId===unitId&&r.year===year&&r.month===month)||null),definition:async v=>clone(defMap.get(v)),history:async(unitId,year,month)=>clone(histories.get(`${unitId}:${year}:${month}`)||[]),save:async input=>{await new Promise(r=>setTimeout(r,50));const index=rows.findIndex(r=>r.unitId===input.unitId&&r.year===input.year&&r.month===input.month),old=rows[index]||null;if((old?.version||0)!==input.baseVersion)throw Error('QMENTUM_VERSION_CONFLICT');const v=old?.version+1||1,definitionVersion=old?.definitionVersion||1,results=calculateMonth(input.inputs,defMap.get(definitionVersion),{inputVersion:v});const data={...clone(input),version:v,definitionVersion,results,status:transitionMonth(old,input.action,'manager',input.reason,results)};if(index<0)rows.push(data);else rows[index]=data;const key=`${input.unitId}:${input.year}:${input.month}`;histories.set(key,[data,...(histories.get(key)||[])]);return data;},publishDefinition:async d=>{defMap.set(d.version,clone(d));},stageImport:async()=>({status:'STAGED'})};
document.querySelector('#app').innerHTML=renderQmentumShell({baseUrl:import.meta.env.BASE_URL,displayName:'DEMONSTRAÇÃO SINTÉTICA LOCAL'});
window.qmentumPreview={rows,histories,year:now.getFullYear(),month:now.getMonth()+1,emptyInputs};
await mountQmentumModule(document.querySelector('#module-content'),{repository,uid:'synthetic-local-only'});
document.documentElement.dataset.qmentumReady='true';
