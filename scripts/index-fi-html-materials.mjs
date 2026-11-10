import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import parse5 from 'parse5';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {createFiServiceToken} from '../worker-fi-control/identity.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {normalize} from '../worker-fi-control/fi-ai-policy.js';

const apply=process.argv[2]==='--apply';
if(process.argv.length>(apply?3:2))throw Error('USE_DRY_RUN_OR_APPLY');
const path='.local-preview/fi-control/service-key.dpapi.json';
const credentials=await openPrivateJson(JSON.parse(await readFile(path,'utf8')));
const getAccessToken=createFiServiceToken({credentials});
const readSource=async(url,options)=>{
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});
   if(attempt===2||![429,500,502,503,504].includes(response.status))return response;
   await response.body?.cancel();
  }catch(error){if(attempt===2)throw error;}
  await delay(500*2**attempt);
 }
};
const source=createFirestoreStore({projectId:FI_PROJECTS.FB,getAccessToken,fetchImpl:readSource});
const target=createFiStore({projectId:FI_PROJECTS.FI,getAccessToken,allowedCollections:['fiSearchRecords']});
const skipped=new Set(['script','style','noscript','template','form','input','textarea','button','svg']);
function sectionText(html){
 const text=[];
 function visit(node){
  if(skipped.has(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'))return;
  if(node.nodeName==='#text'&&node.value.trim())text.push(node.value.trim());
  for(const child of node.childNodes||[])visit(child);
 }
 visit(parse5.parseFragment(html));
 return text.join(' ').replace(/\s+/g,' ').trim();
}
const catalogue=await source.list('htmlTrainings',[],301);
const published=catalogue.filter(row=>row.status==='PUBLISHED').sort((a,b)=>a.id.localeCompare(b.id));
if(!published.length)throw Error('HTML_CATALOGUE_EMPTY');
const entries=[];
for(let start=0;start<published.length;start+=3){
 const batch=await Promise.all(published.slice(start,start+3).map(async row=>{
  const chunks=await source.list('htmlTrainingContent',[{field:'trainingId',op:'EQUAL',value:row.id},{field:'version',op:'EQUAL',value:row.version}],101);
  chunks.sort((a,b)=>a.index-b.index);
  if(!chunks.length||chunks.some((c,i)=>c.trainingId!==row.id||c.version!==row.version||c.index!==i||c.id!==row.id+'_v'+row.version+'_p'+i||typeof c.part!=='string'))throw Error('HTML_CHUNKS_INVALID');
  const sections=JSON.parse(chunks.map(c=>c.part).join(''));
  if(!Array.isArray(sections)||sections.length!==row.sectionCount||sections.some(s=>typeof s.html!=='string'||typeof s.title!=='string'))throw Error('HTML_SECTIONS_INVALID');
  const text=sections.map(s=>[s.title.trim(),sectionText(s.html)].filter(Boolean).join(' · ')).join(' · ');
  if(!text||!row.id||!Number.isSafeInteger(row.version)||typeof row.title!=='string')throw Error('HTML_SEARCH_ENTRY_INVALID');
  return {id:row.id,version:row.version,title:row.title,text,searchText:normalize(text)};
 }));
 entries.push(...batch);
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision=hash(entries);
const bytes=Buffer.from(JSON.stringify(entries));
const compressed=gzipSync(bytes).toString('base64');
if(bytes.length>2*1024*1024||compressed.length>700000)throw Error('HTML_SEARCH_INDEX_TOO_LARGE');
const catalogVersion=rows=>rows.filter(t=>t.status==='PUBLISHED').map(t=>[t.id,t.version,t.title]).sort((a,b)=>a[0].localeCompare(b[0]));
let changed=false;
if(apply){
 const latest=await source.list('htmlTrainings',[],301);
 if(hash(catalogVersion(latest))!==hash(catalogVersion(catalogue)))throw Error('HTML_CATALOGUE_CHANGED');
 changed=await target.transaction(async tx=>{
  const old=await tx.get('fiSearchRecords','html-library');
  if(old?.revision===revision)return false;
  tx.set('fiSearchRecords','html-library-content',{revision,compressed});
  tx.set('fiSearchRecords','html-library',{revision,count:entries.length});
  return true;
 });
 const [manifest,actual]=await target.getMany([['fiSearchRecords','html-library'],['fiSearchRecords','html-library-content']]);
 if(manifest?.revision!==revision||manifest.count!==entries.length||actual?.revision!==revision||actual.compressed!==compressed)throw Error('HTML_SEARCH_INDEX_READBACK_FAILED');
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',materials:entries.length,indexBytes:compressed.length,changed}));
