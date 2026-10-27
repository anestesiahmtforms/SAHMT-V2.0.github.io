import {createHash} from 'node:crypto';
import {buildMemberCategoryRoster,MEMBER_CATEGORIES,normalizeMemberCategories} from '../../src/member-categories.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const MEMBER_CATEGORY_PROJECTS=Object.freeze({FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FD:'rotinas-8a617',FE:'outros-48120'});
export function planMemberCategoryDocuments(rosterInput,accountsByProject){
 const roster=buildMemberCategoryRoster(rosterInput),revision=digest(roster),identities=new Map();
 for(const [alias,accounts] of Object.entries(accountsByProject)){
  if(!Object.hasOwn(MEMBER_CATEGORY_PROJECTS,alias)||!Array.isArray(accounts))throw Error('CATEGORY_PROJECT_INVALID');
  const emails=new Set(),uids=new Set();for(const account of accounts){
   const email=String(account.email||'').trim().toLowerCase();
   if(!roster.some(r=>r.email===email))continue;
   if(!account.uid||/[\s/]/.test(account.uid)||emails.has(email)||uids.has(account.uid))throw Error('CATEGORY_AUTH_AMBIGUOUS');
   emails.add(email);uids.add(account.uid);
   if(identities.has(email)&&identities.get(email)!==account.uid)throw Error('CATEGORY_UID_MISMATCH');
   identities.set(email,account.uid);
  }
 }
 const projects={};
 for(const [alias,accounts] of Object.entries(accountsByProject)){
  const rows=roster.map(row=>{
   const account=accounts.find(a=>String(a.email||'').trim().toLowerCase()===row.email);
   return {path:'userCategories/'+digest(row.email),data:{schemaVersion:1,email:row.email,uid:account?.uid||null,
    memberCategories:normalizeMemberCategories(row.memberCategories),identityStatus:account?'LINKED':'PENDING_ACCOUNT',
    source:'AUTHORIZED_ROSTER',sourceRevision:revision}};
  });
  const definitions=Object.entries(MEMBER_CATEGORIES).map(([id,label])=>({path:'userCategoryDefinitions/'+id,data:{schemaVersion:1,id,label,sourceRevision:revision}}));
  projects[alias]={projectId:MEMBER_CATEGORY_PROJECTS[alias],documents:[...rows,...definitions],linked:rows.filter(r=>r.data.uid).length,pending:rows.filter(r=>!r.data.uid).map(r=>r.data.email)};
 }
 return {revision,totalMembers:roster.length,counts:Object.fromEntries(Object.keys(MEMBER_CATEGORIES).map(id=>[id,roster.filter(r=>r.memberCategories.includes(id)).length])),projects};
}
