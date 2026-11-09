const validUid=v=>typeof v==='string'&&/^[^\s/]{1,128}$/.test(v),email=v=>String(v||'').trim().toLowerCase();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function planFiControlMigration(snapshot){
 if(snapshot?.projectId!=='sahmt-operacional-fi')throw Error('FI_MIGRATION_TARGET');
 const {users,faAccounts,fiAccounts,contacts,categories,appConfig,existing=[]}=snapshot;
 if(![users,faAccounts,fiAccounts,contacts,categories,existing].every(Array.isArray)||users.length>1000||contacts.length>400)throw Error('FI_MIGRATION_INPUT');
 const existingMap=new Map(existing.map(r=>[r.path,r.data])),documents=[],seenUids=new Set(),seenEmails=new Set(),seenFi=new Set();
 const append=(path,data)=>{const current=existingMap.get(path);if(current){if(!same(current,data))throw Error('FI_MIGRATION_DESTINATION');return;}documents.push({path,data});};
 for(const user of users){
  const uid=user.id||user.uid,mail=email(user.email),accounts=faAccounts.filter(a=>a.localId===uid&&email(a.email)===mail),targets=fiAccounts.filter(a=>email(a.email)===mail);
  if(!validUid(uid)||user.uid!==uid||!/^\S+@\S+\.\S+$/.test(mail)||seenUids.has(uid)||seenEmails.has(mail)||accounts.length!==1||targets.length>1)throw Error('FI_MIGRATION_IDENTITY');
  const previous=existingMap.get('fiAdminIdentityLinks/'+uid),fiUid=previous?.fiUid||targets[0]?.localId||uid;
  if(!validUid(fiUid)||seenFi.has(fiUid)||fiAccounts.some(a=>a.localId===fiUid&&email(a.email)!==mail))throw Error('FI_MIGRATION_IDENTITY');
  seenUids.add(uid);seenEmails.add(mail);seenFi.add(fiUid);
  const enabled=user.active===true&&accounts[0].disabled!==true&&accounts[0].emailVerified===true;
  append('fiAdminIdentityLinks/'+uid,{faUid:uid,fiUid,email:mail,active:true,bindingMethod:targets.length?'VERIFIED_FA_AND_FI_AUTH':'EXPLICIT_FI_DIRECTORY_FROM_FA_AUTH'});
  const {id,...source}=user;
  append('fiAdminUsers/'+uid,{...source,uid,email:mail,active:enabled,version:Number.isSafeInteger(user.version)?user.version:0});
  append('users/'+fiUid,{uid:fiUid,faUid:uid,email:mail,displayName:user.displayName||mail,role:user.role||'anestesiologista',sigla:user.sigla||'',active:enabled,access:user.access===true&&enabled,permissions:user.permissions||{},version:1});
 }
 for(const row of contacts){if(!/^(?:[A-Z]{2}|L2)$/.test(row.sigla)||!row.name)throw Error('FI_MIGRATION_CONTACT');const {id,...data}=row;append('contacts/'+row.sigla,{...data,version:Number.isSafeInteger(data.version)?data.version:0});append('eventMembers/'+row.sigla,{id:row.sigla,sigla:row.sigla,name:row.name,active:row.active===true,updatedByUid:row.updatedByUid||row.createdByUid||'migration',updatedAt:row.updatedAt||0});}
 for(const row of categories){const {id,...data}=row;if(!validUid(id))throw Error('FI_MIGRATION_CATEGORY');append('memberCategoryAssignments/'+id,data);}
 if(appConfig){const {id,...data}=appConfig;append('appConfig/app',{id:'app',...data});}
 append('fiControlConfig/runtime',{schemaVersion:1,enabled:true,monthlyBudgetMicros:0,dailyUserLimit:30,purpose:'ADMINISTRATIVE_CONTROL_AND_AI'});
 return {schemaVersion:1,projectId:snapshot.projectId,documents,sourceDeletes:0,counts:{profiles:users.length,contacts:contacts.length,categories:categories.length,plannedDocuments:documents.length}};
}
