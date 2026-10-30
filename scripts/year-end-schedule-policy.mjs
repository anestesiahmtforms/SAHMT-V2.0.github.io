import {mkdir,writeFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey} from '../src/institutional-group.js';
import {decodeFields,encodeFields} from '../worker-training/firestore.js';
import {YEAR_END_SHIFT_ONLY_SIGLAS} from '../src/year-end-schedule.js';

// Private identity mapping stays in FE and .local-preview, never in source control.
const apply=process.argv.includes('--apply');
const [fa,fe]=await Promise.all([firebaseCliAccountToken('anestesiahmtforms@gmail.com'),firebaseCliAccountToken('anestesiahmtforms5@gmail.com')]);
const root=project=>`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function request(project,token,path,{fields=[],list=false}={}){
  const url=new URL(root(project)+'/'+path);
  for(const field of fields)url.searchParams.append('mask.fieldPaths',field);
  if(list)url.searchParams.set('pageSize','100');
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(r.status===404&&!list)return null;
  if(!r.ok)throw Error('READ_FAILED_'+r.status);
  const body=await r.json();if(body.nextPageToken)throw Error('PAGE_LIMIT');
  const decode=d=>({id:d.name.split('/').at(-1),data:decodeFields(d.fields||{}),updateTime:d.updateTime});
  return list?(body.documents||[]).map(decode):decode(body);
}
const [contacts,categories,registrations,previous]=await Promise.all([
  request('sahmt-17a16',fa,'contacts',{list:true,fields:['sigla','email','active']}),
  request('outros-48120',fe,'userCategories',{list:true}),
  request('outros-48120',fe,'yearEndSchedules/2026-2027/registrations',{list:true}),
  request('outros-48120',fe,'yearEndSchedules/2026-2027/policy/participation')
]);
const siglasByUid={},siglas=new Set(),unmatched=[];let excluded=0;
for(const category of categories){
  const {uid}=category.data,email=category.data.email?.trim().toLowerCase();
  const group=assignedInstitutionalGroup(category.data,{uid,email});
  if(group!=='team'){excluded++;continue;}
  if(category.id!==await institutionalAssignmentKey(email))throw Error('CATEGORY_KEY_MISMATCH');
  const profile=await request('outros-48120',fe,'users/'+encodeURIComponent(uid),{fields:['uid','email','active','access']});
  if(profile?.data.active!==true||profile.data.access!==true)continue;
  if(profile.data.uid!==uid||profile.data.email?.trim().toLowerCase()!==email)throw Error('PROFILE_BINDING');
  const matches=contacts.filter(c=>c.data.active===true&&c.data.email?.trim().toLowerCase()===email);
  if(matches.length===0&&/^anestesiahmtforms[2-5]?@gmail[.]com$/.test(email)){excluded++;continue;}
  if(matches.length===0){unmatched.push({uid,email});continue;}
  if(matches.length!==1)throw Error('CANONICAL_CONTACT_REQUIRED');
  const contact=matches[0],sigla=contact.data.sigla||contact.id;
  if(!/^(?:[A-Z]{2}|L2)$/.test(sigla)||contact.id!==sigla||siglas.has(sigla)||siglasByUid[uid])throw Error('CANONICAL_SIGLA_CONFLICT');
  siglas.add(sigla);siglasByUid[uid]=sigla;
}
for(const sigla of YEAR_END_SHIFT_ONLY_SIGLAS)if(!siglas.has(sigla))throw Error('SHIFT_ONLY_MEMBER_MISSING_'+sigla);
// Never overwrite choices or silently migrate records during policy publication.
for(const {data} of registrations)if(data.sigla!==siglasByUid[data.uid]||'displayName' in data)throw Error('REGISTRATION_MIGRATION_REQUIRED');
const policy={schemaVersion:1,cycle:'2026-2027',siglasByUid,source:'FA_CONTACTS_USER_RULE_20261030'};
const summary={eligibleMembers:siglas.size,shiftOnlySiglas:[...YEAR_END_SHIFT_ONLY_SIGLAS],excludedAssignments:excluded,unmatchedTeamAccounts:unmatched.length,existingRegistrations:registrations.length,profileFieldsChanged:0};
await mkdir('.local-preview',{recursive:true});
await writeFile('.local-preview/year-end-policy-plan.json',JSON.stringify({policy,previous,summary,unmatched},null,2));
if(apply){
  const name='projects/outros-48120/databases/(default)/documents/yearEndSchedules/2026-2027/policy/participation';
  const response=await fetch(root('outros-48120')+':commit',{method:'POST',headers:{Authorization:'Bearer '+fe,'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name,fields:encodeFields(policy)},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}}]}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('POLICY_COMMIT_FAILED_'+response.status);
  const verified=await request('outros-48120',fe,'yearEndSchedules/2026-2027/policy/participation');
  if(JSON.stringify(verified.data.siglasByUid)!==JSON.stringify(siglasByUid)){
    if(Object.entries(siglasByUid).some(([uid,sigla])=>verified.data.siglasByUid?.[uid]!==sigla)||Object.keys(verified.data.siglasByUid||{}).length!==siglas.size)throw Error('POLICY_VERIFICATION_FAILED');
  }
}
console.log(JSON.stringify({...summary,applied:apply}));
