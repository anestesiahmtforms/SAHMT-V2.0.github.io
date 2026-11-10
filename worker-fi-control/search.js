import {assertActor,canReadRecord,normalize,safeLink} from './fi-ai-policy.js';
const stopWords=new Set('A AO AOS AS COM DA DAS DE DO DOS E EM NA NAS NO NOS O OS OU PARA POR UM UMA UNS UMAS QUE QUAL QUAIS SOBRE ME MOSTRE BUSCAR PESQUISAR ENCONTRAR ONDE ACHO ENCONTRO POSSO VEJO CONSULTAR'.split(' '));
const words=value=>normalize(value).match(/[A-Z0-9]+/g)||[];
const wordKey=word=>word.length>4&&word.endsWith('S')?word.slice(0,-1):word;
function scoreRecord(record,patterns,phrase){
 const heading=words(record.title).join(' '),text=record.searchText||normalize(record.text);
 let hits=0,titleHits=0;
 for(const {exact,prefix} of patterns){
  if(exact.test(heading)){hits+=2;titleHits++;}
  else if(exact.test(text))hits+=2;
  else if(prefix&&(prefix.test(heading)||prefix.test(text)))hits++;
 }
 if(!hits)return 0;
 const phraseRank=heading===phrase?2:` ${heading} `.includes(` ${phrase} `)?1:0;
 return hits*100+titleHits*2+phraseRank*10000;
}
export function createFiSearch({sourceProvider}) {
 return async function search(actor,{query}={}){
  assertActor(actor);
  if(typeof query!=='string'||!query.trim()||query.length>1000)throw Error('QUERY_INVALID');
  const queryWords=words(query);
  if(!queryWords.length)throw Error('QUERY_INVALID');
  const keywords=queryWords.filter(word=>!stopWords.has(word));
  const terms=[...new Set((keywords.length?keywords:queryWords).map(wordKey))].slice(0,30);
  const patterns=terms.map(term=>({exact:new RegExp('\\b'+term+(term.length>=4?'S?':'')+'\\b'),prefix:term.length>=4?new RegExp('\\b'+term+'[A-Z0-9]+\\b'):null}));
  const phrase=queryWords.join(' ');
  const score=r=>scoreRecord(r,patterns,phrase);
  // The adapter must revalidate current source ACLs, resolved identities and revisions.
  const records=await sourceProvider.searchRecords(actor,score);
  if(!Array.isArray(records)||records.length>10000)throw Error('SOURCE_INVALID');
  const permitted=records.filter(r=>canReadRecord(actor,r));
  // Duplicate IDs are ambiguous citation targets and are excluded entirely.
  const counts=new Map();for(const r of permitted)counts.set(r.id,(counts.get(r.id)||0)+1);
  const ranked=permitted.filter(r=>counts.get(r.id)===1).map(r=>({r,score:score(r)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id));
  const coverage=Array.isArray(sourceProvider.coverage)?structuredClone(sourceProvider.coverage):[];
  const results=[],encoder=new TextEncoder();
  let responseBytes=0;
  for(const {r} of ranked){
   const text=r.searchText||normalize(r.text);
   const positions=patterns.map(({exact,prefix})=>exact.exec(text)?.index??prefix?.exec(text)?.index).filter(Number.isInteger);
   const offset=positions.length?Math.min(...positions):0,start=Math.max(0,offset-80);
   const end=start+650;
   const item={id:r.id,source:r.source,kind:r.kind,title:r.title.slice(0,200),snippet:(start?'…':'')+r.text.slice(start,end)+(end<r.text.length?'…':''),url:safeLink(r.url),version:r.version,readOnly:r.active===false||r.folderActive===false,actionsAllowed:false};
   responseBytes+=encoder.encode(JSON.stringify(item)).length+1;
   if(responseBytes>2*1024*1024)break;
   results.push(item);
  }
  if(results.length<ranked.length)coverage.push({source:'FI',status:'UNAVAILABLE',detail:'Há mais resultados. Acrescente um termo para consultar o restante.'});
  return {results,totalMatches:ranked.length,coverage};
 };
}
