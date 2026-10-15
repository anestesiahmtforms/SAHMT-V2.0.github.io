import {QMENTUM_IDS,getIndicator} from './qmentum-catalog.js';
import {aggregateResults,calculateMonth} from './qmentum-engine.js';
export {calculateMonth};
export const QUARTERLY_VERSION='quarterly-fa-1';
const canonical=x=>x&&typeof x==='object'?Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export function saoPauloPeriod(now=Date.now()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 return {...parts,quarter:Math.ceil(parts.month/3)};
}
export function quarterFacts({rows,indicatorId,year,quarter,now=Date.now()}){
 if(!QMENTUM_IDS.includes(indicatorId)||!Number.isInteger(year)||year<1900||year>2200||![1,2,3,4].includes(quarter))throw Error('QMENTUM_QUARTER_INVALID');
 const today=saoPauloPeriod(now);if(year>today.year||year===today.year&&quarter>=today.quarter)throw Error('QMENTUM_QUARTER_NOT_ENDED');
 const months=Array.from({length:3},(_,i)=>(quarter-1)*3+i+1);
 const selected=months.map(month=>rows.find(r=>r.year===year&&r.month===month)||null);
 const factualResult=r=>r?Object.fromEntries(['indicatorId','N','D','ratio','status','definitionVersion','inputVersion','sourceMode','engineVersion','rule','populationKey','target','targetValidated','targetSource','pending'].map(key=>[key,r[key]??null])):null;
 const series=selected.map((r,i)=>({month:months[i],inputVersion:r?.version||null,result:factualResult(r?.results?.[indicatorId])}));
 const available=series.filter(x=>x.result&&!(x.result.status==='PENDING'&&x.result.ratio===null));
 const aggregate=aggregateResults(series.map(x=>x.result||{indicatorId,status:'PENDING'}));
 const priorYear=quarter===1?year-1:year,priorQuarter=quarter===1?4:quarter-1;
 const previousRows=rows.filter(r=>r.year===priorYear&&Math.ceil(r.month/3)===priorQuarter);
 const previous=previousRows.length===3?aggregateResults(previousRows.map(r=>r.results?.[indicatorId]||{})):null;
 const comparison=aggregate.status==='VALID'&&previous?.status==='VALID'&&previousRows.every(r=>r.results[indicatorId]?.definitionVersion===series[0].result?.definitionVersion)?aggregate.ratio-previous.ratio:null;
 return {schemaVersion:1,indicatorId,year,quarter,months:series,coverage:available.length,status:available.length===0?'NO_DATA':available.length===3&&aggregate.status==='VALID'?'COMPLETE':'PARTIAL',aggregate,previous:previous?{year:priorYear,quarter:priorQuarter,aggregate:previous}:null,comparison,engineVersion:QUARTERLY_VERSION};
}
export function analysisInputSignature(facts,hash){
 // Preserve source versions in the analysis audit, but changing a different
 // indicator in the same monthly document must not spend 18 AI calls.
 const data=JSON.parse(JSON.stringify(facts));
 for(const month of data.months||[]){delete month.inputVersion;if(month.result)delete month.result.inputVersion;}
 return hash(canonical(data));
}
export const sameAnalysisFacts=(a,b)=>!!a&&!!b&&analysisInputSignature(a,x=>x)===analysisInputSignature(b,x=>x);
export function evidenceUsable(evidence,now=Date.now()){
 return evidence?.status==='VERIFIED'&&typeof evidence.version==='string'&&Date.parse(evidence.validUntil)>now&&Array.isArray(evidence.sources)&&evidence.sources.length>0&&evidence.sources.length<=4&&evidence.sources.every(s=>{
  return /^https:\/\/[a-z0-9.-]+(?::443)?\//i.test(s.url||'')&&!/[\s@]/.test(s.url)&&typeof s.title==='string'&&s.title.length<=240&&typeof s.summary==='string'&&s.summary.length<=1200&&Number.isFinite(Date.parse(s.consultedAt));
 });
}
export function aiPayload(facts,evidence){
 const d=getIndicator(facts.indicatorId);
 // Explicit allowlist: no units, authors, UIDs, free-text comments or records.
 return {indicator:{code:d.id,name:d.name,rule:d.rule,direction:d.direction},period:{year:facts.year,quarter:facts.quarter},coverage:facts.coverage,status:facts.status,
  months:facts.months.map(m=>({month:m.month,N:m.result?.N??null,D:m.result?.D??null,ratio:m.result?.ratio??null,status:m.result?.status||'PENDING',target:m.result?.targetValidated?m.result.target:null,pending:m.result?.pending||[]})),
  aggregate:facts.aggregate,previous:facts.previous,comparison:facts.comparison,
  evidence:evidence.sources.map(s=>({title:s.title,url:s.url,summary:s.summary})),evidenceVersion:evidence.version};
}
export function validateAiText(output,payload){
 if(!output||Object.keys(output).sort().join()!=='action,analysis'||![output.analysis,output.action].every(p=>typeof p==='string'&&p.length>=20&&p.length<=340&&!/[\r\n<>]/.test(p)))throw Error('QMENTUM_AI_FORMAT_INVALID');
 // Conservative <= 65 characters per 3 standard mobile lines, 340 chars total.
 const allowed=new Set();const walk=x=>{if(typeof x==='number'){allowed.add(String(x));allowed.add(String(x).replace('.',','));if(x>=0&&x<=1){allowed.add((x*100).toFixed(2));allowed.add((x*100).toFixed(2).replace('.',','));}}else if(x&&typeof x==='object')Object.values(x).forEach(walk);};walk(payload);[1,2,3,4,15,30,48,2026].forEach(n=>allowed.add(String(n)));
 for(const p of [output.analysis,output.action]){
  if(/https?:|www\.|@[\w.]|\[\d+\]|signific[aâ]ncia estat[ií]stica|comprovou causalidade/i.test(p))throw Error('QMENTUM_AI_CONTENT_INVALID');
  for(const n of p.match(/\d+(?:[.,]\d+)?/g)||[])if(!allowed.has(n))throw Error('QMENTUM_AI_UNSUPPORTED_NUMBER');
 }
 return [output.analysis.trim(),output.action.trim()];
}
export function quarterlyPlan({unitId,rows,now,hash}){
 const periods=new Set(rows.filter(r=>r.year>=2026).map(r=>`${r.year}:${Math.ceil(r.month/3)}`)),jobs=[];
 for(const p of [...periods].sort())for(const indicatorId of QMENTUM_IDS){const [year,quarter]=p.split(':').map(Number);let facts;
  try{facts=quarterFacts({rows,indicatorId,year,quarter,now});}catch(e){if(e.message==='QMENTUM_QUARTER_NOT_ENDED')continue;throw e;}
  const signature=analysisInputSignature(facts,hash),id=hash(`${unitId}:${year}:${quarter}:${indicatorId}:${signature}`);
  jobs.push({id,unitId,year,quarter,indicatorId,signature,facts,status:facts.status==='NO_DATA'?'NO_DATA':'QUEUED',attempts:0,nextAt:now+120000,lockUntil:0,version:QUARTERLY_VERSION});
 }
 return jobs;
}
