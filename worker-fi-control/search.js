import {assertActor,canReadRecord,normalize,safeLink,validateEvidence} from './fi-ai-policy.js';
import {createAiBudget} from './fi-ai-budget.js';
import {createMonthlyService} from './monthly.js';
const stopWords=new Set('A AO AOS AS COM DA DAS DE DO DOS E EM NA NAS NO NOS O OS OU PARA POR UM UMA UNS UMAS QUE QUAL QUAIS SOBRE ME MOSTRE BUSCAR PESQUISAR ENCONTRAR'.split(' '));
const words=value=>normalize(value).match(/[A-Z0-9]+/g)||[];
const wordKey=word=>word.length>4&&word.endsWith('S')?word.slice(0,-1):word;
function scoreRecord(record,terms,phrase){
 const title=words(record.title),text=words(record.text);
 const titleKeys=new Set(title.map(wordKey)),textKeys=new Set(text.map(wordKey));
 let hits=0,titleHits=0;
 for(const term of terms){
  if(titleKeys.has(term)){hits++;titleHits++;}
  else if(textKeys.has(term))hits++;
 }
 if(hits<Math.ceil(terms.length/2))return 0;
 const heading=title.join(' ');
 const phraseRank=heading===phrase?2:` ${heading} `.includes(` ${phrase} `)?1:0;
 return hits*100+titleHits*2+phraseRank*10000;
}
export function createFiAiService({store,sourceProvider,modelProvider,now=Date.now,config={}}) {
 const budget=createAiBudget({store,now,config});
 const monthly=createMonthlyService({store,sourceProvider,modelProvider,now,config,budget});
 return {monthly,async search(actor,{query}={}){
  assertActor(actor);
  if(typeof query!=='string'||!query.trim()||query.length>1000)throw Error('QUERY_INVALID');
  const queryWords=words(query);
  if(!queryWords.length)throw Error('QUERY_INVALID');
  const keywords=queryWords.filter(word=>!stopWords.has(word));
  const terms=[...new Set((keywords.length?keywords:queryWords).map(wordKey))].slice(0,30);
  const phrase=queryWords.join(' ');
  // The adapter must revalidate current source ACLs, resolved identities and revisions.
  const records=await sourceProvider.searchRecords(actor,query.trim());
  if(!Array.isArray(records)||records.length>10000)throw Error('SOURCE_INVALID');
  const permitted=records.filter(r=>canReadRecord(actor,r));
  // Duplicate IDs are ambiguous citation targets and are excluded entirely.
  const counts=new Map();for(const r of permitted)counts.set(r.id,(counts.get(r.id)||0)+1);
  const ranked=permitted.filter(r=>counts.get(r.id)===1).map(r=>({r,score:scoreRecord(r,terms,phrase)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id)).slice(0,10);
  const results=ranked.map(({r})=>({id:r.id,source:r.source,kind:r.kind,title:r.title.slice(0,200),snippet:r.text.slice(0,1200),url:safeLink(r.url),version:r.version,readOnly:r.active===false||r.folderActive===false,actionsAllowed:false}));
  const base={results,coverage:Array.isArray(sourceProvider.coverage)?structuredClone(sourceProvider.coverage):[],ai:{status:'no_results'}};
  if(!results.length)return base;
  if(modelProvider?.enabled!==true)return {...base,ai:{status:'disabled'}};
  const modelResults=results.filter(r=>['document','general'].includes(r.kind));
  if(!modelResults.length)return {...base,ai:{status:'local_only'}};
  const reservation=await budget.reserve(actor.uid).catch(()=>undefined);
  if(reservation===undefined)return {...base,ai:{status:'unavailable'}};
  if(!reservation)return {...base,ai:{status:'budget_exhausted'}};
  try {
   const response=await modelProvider.generate({kind:'search',query:query.trim(),context:modelResults.map(r=>({id:r.id,title:r.title,text:r.snippet}))});
   await budget.settle(reservation,response.usage).catch(()=>{});
   const data=response.data;
   if(typeof data?.answer!=='string'||data.answer.length>10000||!validateEvidence(data.citations,new Set(modelResults.map(r=>r.id))))throw Error('ANSWER_INVALID');
   return {...base,ai:{status:'complete',answer:data.answer,citations:[...new Set(data.citations)]}};
  }catch(error){await budget.settle(reservation,error.usage).catch(()=>{});return {...base,ai:{status:'unavailable'}};}
 }};
}
