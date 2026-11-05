import {encodeFields} from '../../worker-communication/store.js';
import {assignedInstitutionalGroup} from '../../src/institutional-group.js';
import {isSystemOwnerEmail} from '../../src/system-account-exclusions.js';
const base=()=> 'projects/sahmt-comunicacao-ff/databases/comunicacao/documents';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const clean=row=>Object.fromEntries(Object.entries(row).filter(([k,v])=>!['id','updateTime'].includes(k)&&v!==undefined));
export function buildCommunicationDirectoryImport(snapshot){
 for(const rows of [snapshot.fbUsers,snapshot.ffUsers,snapshot.authUsers,snapshot.categories]){const seen=new Set();for(const row of rows){const email=row.email?.trim().toLowerCase();if(!email)continue;check(!seen.has(email),'FF_IMPORT_IDENTITY_AMBIGUOUS');seen.add(email);}}
 const byEmail=new Map(),fbUidEmail=new Map(snapshot.fbUsers.map(u=>[u.uid,u.email?.trim().toLowerCase()]));
 const existingFfByEmail=new Map(snapshot.ffUsers.map(u=>[u.email?.trim().toLowerCase(),u]));
 const authByEmail=new Map(snapshot.authUsers.map(u=>[u.email?.toLowerCase(),u]));
 const assignments=new Map(snapshot.categories.map(u=>[u.email?.trim().toLowerCase(),u]));
 let missingAffiliations=0;const writes=[];
 for(const original of snapshot.faUsers){
  const email=original.email?.trim().toLowerCase();if(email==='wx2901@gmail.com')continue;
  if(!email){check(original.active!==true||original.access!==true,'FF_IMPORT_ACTIVE_EMAIL_MISSING');continue;}
  check(original.uid===original.id&&!byEmail.has(email),'FF_IMPORT_IDENTITY_AMBIGUOUS');
  const group=assignedInstitutionalGroup(assignments.get(email),{uid:[...fbUidEmail].find(([,value])=>value===email)?.[0],email});
  if(original.active&&original.access&&!group&&!isSystemOwnerEmail(email))missingAffiliations++;
  const auth=authByEmail.get(email),old=existingFfByEmail.get(email);
  const profile={...clean(original),...(old?clean(old):{}),uid:original.uid,email,institutionalGroup:group||'',...(auth?{ffUid:auth.localId}:{}),directoryOrigin:'FF_LOCAL_INITIAL_IMPORT',directoryImportedAt:snapshot.at};
  writes.push({update:{name:base('FF')+'/users/'+original.uid,fields:encodeFields(profile)},currentDocument:old?.id===original.uid?{updateTime:old.updateTime}:{exists:false}});
  if(old&&old.id!==original.uid)writes.push({delete:base('FF')+'/users/'+old.id,currentDocument:{updateTime:old.updateTime}});
  byEmail.set(email,original.uid);
 }
 check(missingAffiliations===0,'FF_IMPORT_AFFILIATION_MISSING');
 for(const old of snapshot.ffUsers.filter(u=>u.email?.trim().toLowerCase()==='wx2901@gmail.com'))writes.push({delete:base('FF')+'/users/'+old.id,currentDocument:{updateTime:old.updateTime}});
 const absent=new Set((snapshot.absentMemberships||[]).filter(p=>p.source===snapshot.groupSource&&p.reason==='SOURCE_AUTH_ACCOUNT_ABSENT'&&Number.isFinite(Date.parse(p.verifiedAt))).map(p=>p.uid));
 const translate=ids=>[...new Set((ids||[]).map(uid=>{const email=fbUidEmail.get(uid);if(email==='wx2901@gmail.com'||uid==='EVUyLGKSjPZa5mvVI6evXLROern1'||!email&&absent.has(uid))return null;const local=byEmail.get(email);check(local,'FF_IMPORT_GROUP_MEMBER_UNMAPPED');return local;}).filter(Boolean))];
 for(const area of snapshot.areas){const local={...clean(area),memberUids:translate(area.memberUids),managerUids:translate(area.managerUids),directoryOrigin:'FF_LOCAL_INITIAL_IMPORT'};writes.push({update:{name:base('FF')+'/managementAreas/'+area.id,fields:encodeFields(local)},currentDocument:{exists:false}});}
 for(const device of snapshot.devices){if(device.email?.trim().toLowerCase()==='wx2901@gmail.com'){writes.push({delete:base('FF')+'/communicationDevices/'+device.id,currentDocument:{updateTime:device.updateTime}});continue;}const local=byEmail.get(device.email);check(local,'FF_IMPORT_DEVICE_UNMAPPED');writes.push({update:{name:base('FF')+'/communicationDevices/'+device.id,fields:encodeFields({...clean(device),sourceUid:local})},currentDocument:{updateTime:device.updateTime}});}
 for(const recipient of snapshot.recipients){if(recipient.email?.trim().toLowerCase()==='wx2901@gmail.com'){writes.push({delete:base('FF')+'/communicationRecipients/'+recipient.id,currentDocument:{updateTime:recipient.updateTime}});continue;}const local=byEmail.get(recipient.email);check(local,'FF_IMPORT_RECIPIENT_UNMAPPED');writes.push({update:{name:base('FF')+'/communicationRecipients/'+recipient.id,fields:encodeFields({...clean(recipient),sourceUid:local})},currentDocument:{updateTime:recipient.updateTime}});}
 // Old notices keep local audience IDs. Restore direct FF pointers for release banners.
 const latest=new Map();for(const m of snapshot.messages)if(m.id.startsWith('release-')&&m.status==='published'&&m.audienceType==='USER'&&(!latest.has(m.audienceValue)||latest.get(m.audienceValue).publishAt<m.publishAt))latest.set(m.audienceValue,m);
 for(const [uid,m]of latest)writes.push({update:{name:base('FF')+'/communicationReleaseInboxes/'+uid,fields:encodeFields({messageId:m.id,releaseAt:Number(m.id.split('-').at(-1))||m.publishAt})},currentDocument:{exists:false}});
 check(writes.length<=400,'FF_IMPORT_ATOMIC_WRITE_LIMIT');
 return {writes,summary:{users:byEmail.size,areas:snapshot.areas.length,devices:snapshot.devices.length,recipients:snapshot.recipients.length,missingAffiliations,writes:writes.length}};
}
