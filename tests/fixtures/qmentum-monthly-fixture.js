// Entirely synthetic UI fixture. No institutional values, Firebase or remote writes.
import {mountQmentumModule} from '../../src/qmentum-ui.js';
import {emptyInputs,initialDefinitions,COUNT_KEYS} from '../../src/qmentum-catalog.js';
import {periodKey} from '../../src/qmentum-engine.js';
import {renderQmentumShell} from '../../src/qmentum-shell.js';
import '../../src/styles.css';

export async function mountMonthlyFixture(root,{role='manager',withLatest=true,withPrints=false,legacy=false}={}) {
 const definitions=initialDefinitions();
 Object.values(definitions.items).forEach(d=>{d.approved=true;d.criterion='Synthetic monthly UI definition';});
 const rows=Array.from({length:6},(_,i)=>{
  const month=i+1,inputs=emptyInputs();
  for(const key of COUNT_KEYS){inputs.counts[key]=10000+month;inputs.origins[key]='IMPORTED';}
  inputs.counts.techniqueChanges=month;inputs.counts.headache=month;
  if(legacy){delete inputs.counts.anestheticProcedures;delete inputs.origins.anestheticProcedures;}
  return {unitId:'synthetic-a',year:2026,month,period:periodKey(2026,month),version:1,status:'DRAFT',definitionVersion:1,referenceDate:periodKey(2026,month)+'-17',inputs};
 });
 const other=structuredClone(rows[0]);other.unitId='synthetic-b';other.year=2025;other.month=9;other.period='2025-09';other.referenceDate='2025-09-13';rows.push(other);
 const state={rows,writes:[],latestReads:[],failedYear:null,failedUnit:null,failedDefinition:false};
 const repository={
  open:async()=>({access:{role},units:[{unitId:'synthetic-a',name:'Synthetic A'},{unitId:'synthetic-b',name:'Synthetic B'}],definitions}),
  year:async(unitId,year)=>{
   if(state.failedUnit===unitId||state.failedYear===year)throw Error('Synthetic failed load');
   return structuredClone(rows.filter(r=>r.unitId===unitId&&r.year===year).map(r=>({...r,definitionVersion:state.failedDefinition?2:1})));
  },
  definition:async version=>{if(version===2)throw Error('Synthetic failed definition');return structuredClone(definitions);},
  history:async()=>[],
  save:async command=>{
   state.writes.push(structuredClone(command));
   const index=rows.findIndex(r=>r.unitId===command.unitId&&r.year===command.year&&r.month===command.month);
   const saved={...structuredClone(command),version:(rows[index]?.version||0)+1,status:'DRAFT'};
   if(index<0)rows.push(saved);else rows[index]=saved;
   return saved;
  }
 };
 if(withPrints){state.printCalls=[];repository.prints={scan:async payload=>{state.printCalls.push(payload);return{candidates:[{period:'2026-08',status:'NEW'}]};},preview:async()=>{throw Error('SYNTHETIC_UNUSED');},apply:async()=>{throw Error('SYNTHETIC_UNUSED');}};}
 if(withLatest)repository.latest=async unitId=>{
  state.latestReads.push(unitId);
  if(state.failedUnit===unitId)throw Error('Synthetic failed latest');
  const record=rows.filter(r=>r.unitId===unitId).sort((a,b)=>b.year-a.year||b.month-a.month)[0];
  return record?{year:record.year,month:record.month,period:record.period}:null;
 };
 const drafts={read:()=>null,save:()=>{},remove:()=>{}};
 root.innerHTML=renderQmentumShell({baseUrl:import.meta.env.BASE_URL,displayName:'Synthetic monthly UI'});
 state.cleanup=await mountQmentumModule(root.querySelector('#module-content'),{repository,uid:'synthetic-monthly-ui',drafts});
 return state;
}
