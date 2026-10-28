import fs from 'node:fs/promises';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';import {buildDosimetryImportPlan} from './lib/dosimetry-import-plan.js';import {decodeFields,encodeFields} from '../worker-training/firestore.js';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];},apply=args.includes('--apply');
const files=Object.fromEntries(['pdf','extraction','bindings','contacts'].map(name=>[name,arg('--'+name)]));if(Object.values(files).some(v=>!v))throw Error('Use --pdf PRIVATE_PDF --extraction PRIVATE_JSON --bindings PRIVATE_JSON --contacts PRIVATE_JSON [--apply]');
const dir=resolve('.local-preview/dosimetry');await fs.mkdir(dir,{recursive:true});
const pdf=await fs.readFile(files.pdf);if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('DOSIMETRY_PDF_REQUIRED');const pdfFingerprint=createHash('sha256').update(pdf).digest('hex');
const [extraction,bindings,contacts]=await Promise.all(['extraction','bindings','contacts'].map(async key=>JSON.parse(await fs.readFile(files[key],'utf8'))));
const token=await firebaseCliAccountToken('anestesiahmtforms2@gmail.com'),root='projects/sahmt-gestao-5ae66/databases/(default)/documents';
async function api(path,body){const r=await fetch('https://firestore.googleapis.com/v1/'+root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok){await r.body?.cancel();throw Error('DOSIMETRY_IMPORT_HTTP_'+r.status);}return r.json();}
async function list(collection,mask=[]){let page='',rows=[];do{const q=new URLSearchParams({pageSize:'1000'});if(page)q.set('pageToken',page);for(const f of mask)q.append('mask.fieldPaths',f);const b=await api('/'+collection+'?'+q);rows.push(...(b.documents||[]).map(d=>({id:d.name.split('/').at(-1),...decodeFields(d.fields||{}),updateTime:d.updateTime})));page=b.nextPageToken||'';}while(page);return rows;}
const profiles=await list('users',['uid','email','active','access']),existing=await list('occupationalDosimetry');
const plan=buildDosimetryImportPlan({extraction,bindings,contacts,profiles,existing,pdfFingerprint});await fs.writeFile(resolve(dir,'import-plan.private.json'),JSON.stringify(plan,null,2));
if(apply){
 const checked=buildDosimetryImportPlan({extraction,bindings,contacts,profiles:await list('users',['uid','email','active','access']),existing,pdfFingerprint});if(checked.revision!==plan.revision)throw Error('DOSIMETRY_PROFILES_CHANGED');
 const changed=plan.documents.filter(d=>d.changed);if(changed.length>100)throw Error('DOSIMETRY_IMPORT_LIMIT');await fs.writeFile(resolve(dir,'before-import.private.json'),JSON.stringify(existing,null,2));
 if(changed.length)await api(':commit',{writes:changed.map(d=>({update:{name:root+'/'+d.path,fields:encodeFields(d.data)},currentDocument:d.exists?{updateTime:d.updateTime}:{exists:false}}))});
 const after=buildDosimetryImportPlan({extraction,bindings,contacts,profiles,existing:await list('occupationalDosimetry'),pdfFingerprint});if(after.summary.changes)throw Error('DOSIMETRY_VERIFY_FAILED');console.log(JSON.stringify({applied:true,...after.summary,recordsWritten:changed.length,sharingChanges:0}));
}else console.log(JSON.stringify({applied:false,...plan.summary,sharingChanges:0}));
