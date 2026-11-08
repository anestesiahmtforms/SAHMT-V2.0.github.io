import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {decodeFields} from '../worker-indicators/store.js';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

// Read only: private account/profile data stay in memory; stdout contains counts.
// Password/email providers are deliberately excluded: email equality is not proof.
export function reconcileProviderIdentities(primary, destination) {
 const keys=u=>(u.providerUserInfo||[]).filter(p=>p.providerId==='google.com'&&typeof p.rawId==='string'&&p.rawId).map(p=>p.providerId+':'+p.rawId);
 const index=new Map();
 for(const u of destination)for(const key of keys(u)){const entries=index.get(key)||new Set();entries.add(u.localId);index.set(key,entries);}
 const matches=new Map(),counts={verifiedProvider:0,missingProviderEvidence:0,ambiguous:0,duplicateDestination:0};
 for(const u of primary){const ids=new Set(keys(u).flatMap(k=>[...(index.get(k)||[])]));if(ids.size===1){matches.set(u.localId,[...ids][0]);counts.verifiedProvider++;}else if(ids.size>1)counts.ambiguous++;else counts.missingProviderEvidence++;}
 const reverse=new Map();for(const id of matches.values())reverse.set(id,(reverse.get(id)||0)+1);
 counts.duplicateDestination=[...reverse.values()].filter(n=>n>1).length;
 return {matches,counts};
}
export const SAHMT_IDENTITY_AUDIT_TARGETS=Object.freeze({FD:['rotinas-8a617','4'],FG:['sahmt-checklist-fg','7'],FI:['sahmt-operacional-fi','9'],FB:['sahmt-gestao-5ae66','2'],FC:['indicadores---sahmt','3'],FE:['outros-48120','5']});
async function get(url,token){const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok){await r.body?.cancel();throw Error('READ_HTTP_'+r.status);}return r.json();}
async function pages(base,token,key,param){const out=[],seen=new Set();let next='';do{const url=new URL(base);if(next)url.searchParams.set(param,next);const data=await get(url,token);out.push(...(data[key]||[]));next=data.nextPageToken||'';if(out.length>10000||seen.has(next)&&next)throw Error('READ_PAGE_LIMIT');seen.add(next);}while(next);return out;}
export async function auditSahmtIdentityDirectory(){
 const captures={},report={identityAuthority:'FD',dataWrites:0,privateFilesWritten:0,atomicSnapshot:false,projects:{}};
 for(const [alias,[project,suffix]]of Object.entries(SAHMT_IDENTITY_AUDIT_TARGETS)){
  try{const token=await firebaseCliAccountToken(alias==='FG'?'sahmtcheck@gmail.com':'anestesiahmtforms'+suffix+'@gmail.com');
   const auth=await pages(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000`,token,'users','nextPageToken');
   const docs=await pages(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users?pageSize=1000`,token,'documents','pageToken');
   const profiles=docs.map(d=>({id:d.name.split('/').at(-1),...decodeFields(d.fields||{})}));
   captures[alias]={auth,profiles};const ids=new Set(auth.map(u=>u.localId));
   report.projects[alias]={auth:auth.length,profiles:profiles.length,eligibleProfiles:profiles.filter(p=>p.active===true&&p.access===true).length,profilesWithoutAuth:profiles.filter(p=>!ids.has(p.id)).length,disabledAuth:auth.filter(u=>u.disabled===true).length};
  }catch(e){report.projects[alias]={blocked:/^(READ_[A-Z0-9_]+|CLI_ACCOUNT_[A-Z_]+)$/.test(e.message)?e.message:'READ_UNAVAILABLE'};}
 }
 if(captures.FD){const eligible=new Set(captures.FD.profiles.filter(p=>p.active===true&&p.access===true).map(p=>p.id));const primary=captures.FD.auth.filter(u=>eligible.has(u.localId)&&u.disabled!==true);report.eligibleFdAuth=primary.length;
  for(const [alias,c]of Object.entries(captures)){if(alias==='FD')continue;report.projects[alias].providerReconciliation=reconcileProviderIdentities(primary,c.auth).counts;report.projects[alias].sameUidUnproven=primary.filter(u=>c.auth.some(d=>d.localId===u.localId)).length;}
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED');console.log(JSON.stringify(await auditSahmtIdentityDirectory()));}
