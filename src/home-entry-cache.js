// Presentation only. No Firebase, network, credentials, permissions or pending writes.
const PROJECT='sahmt-escala-fj',PREFIX='sahmt-fa-home-view:v1:',MAX_AGE=7*86400000,MAX_DAYS=14,MAX_BYTES=128*1024;
const dayValid=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
const short=value=>typeof value==='string'?value.slice(0,160):'';
function projection(value){
 if(!value?.schedule||typeof value.schedule!=='object')return null;
 const schedule=value.schedule,positions=schedule.assignments??schedule.siglas??schedule.positions;
 if(!Array.isArray(positions)||positions.length>100||!Array.isArray(value.vacations)||value.vacations.length>100)return null;
 return {schedule:{positions:positions.map(item=>typeof item==='string'?{sigla:short(item)}:{sigla:short(item?.sigla||item?.name||item?.label),position:short(String(item?.position||'')),function:short(item?.function)}),weekdayLabel:short(schedule.weekdayLabel),vacationLabel:short(schedule.vacationLabel),stale:true},
  vacations:value.vacations.map(item=>({label:short(item?.label),siglas:Array.isArray(item?.siglas)?item.siglas.slice(0,100).map(short):[]}))};
}
export function createHomeScheduleCache({storage,now=Date.now}={}){
 const target=()=>storage??globalThis.localStorage;
 const key=uid=>typeof uid==='string'&&uid.length>0&&uid.length<=200?PREFIX+encodeURIComponent(uid):null;
 const load=uid=>{const raw=target()?.getItem(key(uid));if(!raw||raw.length*2>MAX_BYTES)return [];const value=JSON.parse(raw);return value.schema===1&&value.uid===uid&&value.sourceProject===PROJECT&&Array.isArray(value.days)&&value.days.length<=MAX_DAYS?value.days:[];};
 return Object.freeze({
  read(uid,day){try{if(!key(uid)||!dayValid(day))return null;const entry=load(uid).find(e=>e.day===day);if(!entry||!Number.isFinite(entry.savedAt)||entry.savedAt>now()||now()-entry.savedAt>MAX_AGE)return null;const safe=projection(entry);return safe?{...safe,savedAt:entry.savedAt,sourceProject:PROJECT}:null;}catch{return null;}},
  write(uid,day,value){try{if(!key(uid)||!dayValid(day))return false;const destination=target();if(typeof destination?.setItem!=='function')return false;let days;try{days=load(uid).filter(e=>e&&typeof e==='object');}catch{days=[];}if(value?.schedule!==null){const safe=projection(value);if(!safe)return false;days=days.filter(e=>e.day!==day);days.push({day,savedAt:now(),...safe});}else days=days.filter(e=>e.day!==day);
   days=days.filter(e=>Number.isFinite(e.savedAt)&&e.savedAt<=now()&&now()-e.savedAt<=MAX_AGE).sort((a,b)=>b.savedAt-a.savedAt).slice(0,MAX_DAYS);
   const serialized=JSON.stringify({schema:1,uid,sourceProject:PROJECT,days});if(serialized.length*2>MAX_BYTES)return false;destination.setItem(key(uid),serialized);return true;}catch{return false;}},
  clear(uid){try{if(key(uid))target()?.removeItem(key(uid));}catch{}}
 });
}
export const homeScheduleCache=createHomeScheduleCache();
