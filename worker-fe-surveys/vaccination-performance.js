import {VACCINES} from '../src/vaccination-domain.js';
import {performanceActive} from './performance-award.js';

// Separate ledger excludes the retired completion bonus from FE balances.
export const VACCINATION_PERFORMANCE_PREFIX='feVaccinationUpdatedPerformance';
export async function awardUpdatedVaccinations(tx,record) {
 const at=record.updatedAt;
 if(!performanceActive(await tx.get('fePerformanceRuntime','current'),at))return;
 const prefix=VACCINATION_PERFORMANCE_PREFIX;
 const candidates=VACCINES.filter(v=>record.states[v.id]==='UPDATED').map(v=>({
  vaccine:v.id,key:record.uid+'_vaccination_'+record.year+'_'+v.id
 }));
 const previous=await Promise.all(candidates.map(v=>tx.get(prefix+'Awards',v.key)));
 const fresh=candidates.filter((v,i)=>!previous[i]);
 if(!fresh.length)return;
 const summary=await tx.get(prefix+'Summaries',record.uid);
 for(const {vaccine,key} of fresh)tx.create(prefix+'Awards',key,{
  uid:record.uid,category:'PERFORMANCE',points:1,survey:'vaccination',
  cycle:String(record.year),vaccine,createdAt:at
 });
 tx.set(prefix+'Summaries',record.uid,{uid:record.uid,total:(summary?.total||0)+fresh.length,updatedAt:at});
}
