import {createHash} from 'node:crypto';
export const PROFESSIONAL_ROOT='1ETtQoCK4DBQ06gwecJbb0Ac5SneAnRGK';
const contexts={'Vacinação':'VACCINATION','Documentação cadastral':'REGISTRATION','Certificados e cursos':'CERTIFICATES','Documentação profissional':'PROFESSIONAL'};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const email=value=>String(value||'').trim().toLowerCase();
const owner=value=>/^anestesiahmtforms(?:[2-5])?@gmail\.com$/.test(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildProfessionalFolderPlan({folderMap,identityMap,profiles,existing=[]}){
 if(folderMap?.parentFolderId!==PROFESSIONAL_ROOT||!Array.isArray(folderMap.professionals)||identityMap?.parentFolderId!==PROFESSIONAL_ROOT||!Array.isArray(identityMap.folders)||!Array.isArray(profiles))throw Error('PROFESSIONAL_FOLDER_SOURCE_INVALID');
 const ids=new Set([PROFESSIONAL_ROOT]),emails=new Set(),folders=new Map(),identities=new Map(),profileEmails=new Set(),profileUids=new Set();
 for(const row of identityMap.folders){const address=email(row.email);if(!validId(row.uid)||!validId(row.folderId)||identities.has(address)||owner(address))throw Error('PROFESSIONAL_FOLDER_IDENTITY_INVALID');identities.set(address,row);}
 for(const row of folderMap.professionals){
  const address=email(row.email),identity=identities.get(address);
  if(!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(address)||owner(address)||emails.has(address)||!validId(row.parentId)||ids.has(row.parentId)||identity?.folderId!==row.parentId||!Array.isArray(row.children)||row.children.length!==4)throw Error('PROFESSIONAL_FOLDER_SOURCE_INVALID');
  emails.add(address);ids.add(row.parentId);const categories={};
  for(const child of row.children){const context=contexts[child.name];if(!context||Object.hasOwn(categories,context)||!validId(child.id)||ids.has(child.id))throw Error('PROFESSIONAL_FOLDER_SOURCE_INVALID');ids.add(child.id);categories[context]=child.id;}
  folders.set(address,{professionalFolderId:row.parentId,categories});
 }
 const documents=[],missing=[];
 for(const p of profiles){
  const address=email(p.email),uid=p.uid||p.id;if(owner(address))continue;
  if(!validId(uid)||p.uid&&p.id&&p.uid!==p.id||!address||profileEmails.has(address)||profileUids.has(uid))throw Error('PROFESSIONAL_PROFILE_AMBIGUOUS');
  profileEmails.add(address);profileUids.add(uid);const folder=folders.get(address),identity=identities.get(address);
  if(!folder||!identity){missing.push(address);continue;}if(identity.uid!==uid)throw Error('PROFESSIONAL_FOLDER_UID_CHANGED');
  const data={schemaVersion:1,uid,email:address,active:p.active===true&&p.access===true,rootFolderId:PROFESSIONAL_ROOT,professionalFolderId:folder.professionalFolderId,categories:folder.categories};
  const current=existing.find(row=>(row.uid||row.id)===uid);
  const previous=current?Object.fromEntries(Object.keys(data).map(k=>[k,current[k]])):null;
  const normalize=x=>x?{...x,categories:Object.fromEntries(Object.entries(x.categories||{}).sort(([a],[b])=>a.localeCompare(b)))}:null;
  documents.push({path:'professionalDocumentFolders/'+uid,data,changed:hash(normalize(data))!==hash(normalize(previous)),exists:!!current,updateTime:current?.updateTime||null});
 }
 const unmatched=[...folders.keys()].filter(address=>!profileEmails.has(address));
 return{projectId:'sahmt-gestao-5ae66',rootFolderId:PROFESSIONAL_ROOT,documents,missing,unmatched,ready:!missing.length&&!unmatched.length,revision:hash(documents.map(row=>row.data)),summary:{professionals:documents.length,categoryFolders:documents.length*4,changes:documents.filter(d=>d.changed).length,excludedOwners:profiles.filter(p=>owner(email(p.email))).length}};
}
