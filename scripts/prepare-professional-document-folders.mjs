import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {buildProfessionalFolderPlan} from './lib/professional-folder-plan.js';
import {decodeFields,encodeFields} from '../worker-training/firestore.js';
const args=process.argv.slice(2),apply=args.includes('--apply');
const readArg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const folderPath=readArg('--folders'),identityPath=readArg('--identities');
if(!folderPath||!identityPath||args.some((x,i)=>x.startsWith('--')&&!['--folders','--identities','--apply'].includes(x)))throw Error('Use --folders PRIVATE_MAP --identities PRIVATE_IDENTITY_MAP [--apply]');
const project='sahmt-gestao-5ae66',root=`projects/${project}/databases/(default)/documents`,directory=resolve('.local-preview/professional-folders');
await mkdir(directory,{recursive:true});
const token=await firebaseCliAccountToken('anestesiahmtforms2@gmail.com');
async function api(path,body){const r=await fetch('https://firestore.googleapis.com/v1/'+root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok){await r.body?.cancel();throw Error('PROFESSIONAL_FOLDER_HTTP_'+r.status);}return r.json();}
async function list(collection,mask=[]){let page='',rows=[];do{const q=new URLSearchParams({pageSize:'1000'});if(page)q.set('pageToken',page);for(const field of mask)q.append('mask.fieldPaths',field);const r=await api('/'+collection+'?'+q);rows.push(...(r.documents||[]).map(d=>({id:d.name.split('/').at(-1),...decodeFields(d.fields||{}),updateTime:d.updateTime})));page=r.nextPageToken||'';}while(page);return rows;}
const folderMap=JSON.parse(await readFile(folderPath,'utf8')),identityMap=JSON.parse(await readFile(identityPath,'utf8'));
const profiles=await list('users',['uid','email','active','access']);
const existing=await list('professionalDocumentFolders');
const plan=buildProfessionalFolderPlan({folderMap,identityMap,profiles,existing});
await writeFile(resolve(directory,'plan.private.json'),JSON.stringify(plan,null,2));
if(!plan.ready){console.log(JSON.stringify({code:'PROFESSIONAL_FOLDER_REVIEW_NEEDED',missing:plan.missing.length,unmatched:plan.unmatched.length,...plan.summary}));process.exitCode=2;}
else if(apply){
 const currentProfiles=await list('users',['uid','email','active','access']);const checked=buildProfessionalFolderPlan({folderMap,identityMap,profiles:currentProfiles,existing});
 if(checked.revision!==plan.revision)throw Error('PROFESSIONAL_FOLDER_PROFILES_CHANGED');
 const changes=plan.documents.filter(row=>row.changed);if(changes.length>450)throw Error('PROFESSIONAL_FOLDER_COMMIT_LIMIT');
 await writeFile(resolve(directory,'before.private.json'),JSON.stringify(existing,null,2));
 if(changes.length)await api(':commit',{writes:changes.map(row=>({update:{name:root+'/'+row.path,fields:encodeFields(row.data)},currentDocument:row.exists?{updateTime:row.updateTime}:{exists:false}}))});
 const after=buildProfessionalFolderPlan({folderMap,identityMap,profiles:currentProfiles,existing:await list('professionalDocumentFolders')});
 if(!after.ready||after.summary.changes)throw Error('PROFESSIONAL_FOLDER_VERIFY_FAILED');
 console.log(JSON.stringify({code:'PROFESSIONAL_FOLDERS_CONFIGURED',...after.summary,written:changes.length,permissionChanges:0,uploadedFiles:0}));
}else console.log(JSON.stringify({code:'PROFESSIONAL_FOLDER_PREVIEW',...plan.summary,permissionChanges:0,uploadedFiles:0}));
