import {assertActor,canReadRecord,normalize,safeLink,validateEvidence} from './fi-ai-policy.js';
import {createAiBudget} from './fi-ai-budget.js';
import {createMonthlyService} from './monthly.js';
export function createFiAiService({store,sourceProvider,modelProvider,now=Date.now,config={}}) {
 const budget=createAiBudget({store,now,config});
 const monthly=createMonthlyService({store,sourceProvider,modelProvider,now,config,budget});
 return {monthly,async search(actor,{query}={}){
  assertActor(actor);
  if(typeof query!=='string'||!query.trim()||query.length>1000)throw Error('QUERY_INVALID');
  const terms=[...new Set(normalize(query).split(/[^A-Z0-9]+/).filter(Boolean))].slice(0,30);
  if(!terms.length)throw Error('QUERY_INVALID');
  // The adapter must revalidate current source ACLs, resolved identities and revisions.
  const records=await sourceProvider.searchRecords(actor,query.trim());
  if(!Array.isArray(records)||records.length>10000)throw Error('SOURCE_INVALID');
  const permitted=records.filter(r=>canReadRecord(actor,r));
  // Duplicate IDs are ambiguous citation targets and are excluded entirely.
  const counts=new Map();for(const r of permitted)counts.set(r.id,(counts.get(r.id)||0)+1);
  const ranked=permitted.filter(r=>counts.get(r.id)===1).map(r=>({r,score:terms.reduce((score,t)=>score+(normalize(r.title).includes(t)?3:0)+(normalize(r.text).includes(t)?1:0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id)).slice(0,10);
  const results=ranked.map(({r})=>({id:r.id,source:r.source,kind:r.kind,title:r.title.slice(0,200),snippet:r.text.slice(0,1200),url:safeLink(r.url),version:r.version,readOnly:r.active===false||r.folderActive===false,actionsAllowed:false}));
  const base={results,coverage:Array.isArray(sourceProvider.coverage)?structuredClone(sourceProvider.coverage):[],ai:{status:'no_results'}};
  if(!results.length)return base;
  if(modelProvider?.enabled!==true)return {...base,ai:{status:'disabled'}};
  const reservation=await budget.reserve(actor.uid);
  if(!reservation)return {...base,ai:{status:'budget_exhausted'}};
  try {
   const response=await modelProvider.generate({kind:'search',query:query.trim(),context:results.map(r=>({id:r.id,title:r.title,text:r.snippet}))});
   await budget.settle(reservation,response.usage);
   const data=response.data;
   if(typeof data?.answer!=='string'||data.answer.length>10000||!validateEvidence(data.citations,new Set(results.map(r=>r.id))))throw Error('ANSWER_INVALID');
   return {...base,ai:{status:'complete',answer:data.answer,citations:[...new Set(data.citations)]}};
  }catch(error){await budget.settle(reservation,error.usage);return {...base,ai:{status:'unavailable'}};}
 }};
}
