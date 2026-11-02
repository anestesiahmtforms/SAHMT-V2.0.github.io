import {vacationSchedule,VACATION_MONTHS} from '../src/vacations-2027-domain.js';
export const vacationHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function vacationSnapshot(data,now=Date.now()){
 const parsed=vacationSchedule(data.values,data.rules);
 return {schemaVersion:2,projectId:'outros-48120',cycle:'2027',revision:1,...parsed,version:await vacationHash(parsed),updatedAt:now,
  source:{spreadsheetId:'1NFR4jJUV2HRWD68hrh3zT8g6N1i3sGrQ5LXexf-Xm8w',folderId:'1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl',importedAt:now}};
}
export function assertVacationSnapshot(data){
 const fail=()=>{throw Object.assign(Error('VACATIONS_SNAPSHOT_UNAVAILABLE'),{code:'VACATIONS_SNAPSHOT_UNAVAILABLE',status:503});};
 if(data?.schemaVersion!==2||data.projectId!=='outros-48120'||data.cycle!=='2027'||!Number.isSafeInteger(data.revision)||data.revision<1||!/^[a-f0-9]{64}$/.test(data.version||'')||!Array.isArray(data.months)||data.months.length!==12||!Array.isArray(data.siglas)||!data.siglas.length||typeof data.rules!=='object'||!data.rules)fail();
 for(let i=0;i<12;i++){
  const month=data.months[i],definition=VACATION_MONTHS[i];
  if(month.id!==definition[0]||!Array.isArray(month.weeks)||month.weeks.length!==definition[2].length)fail();
  for(let w=0;w<month.weeks.length;w++)if(!Array.isArray(month.weeks[w].slots)||month.weeks[w].slots.length!==3||month.weeks[w].slots.some((s,j)=>s.id!==`${month.id}-${w}-${j}`||typeof s.value!=='string'))fail();
 }
 if(data.siglas.some(s=>!Array.isArray(data.rules[s])||data.rules[s].length!==5||data.rules[s].some(n=>n!==0&&n!==1)))fail();
 return data;
}
