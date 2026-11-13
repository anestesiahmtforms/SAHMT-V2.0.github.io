import {DEFAULT_APP_FEATURES,normalizeAppFeatures} from '../src/feature-flags.js';
import {withGeneralReadPermissions} from '../src/general-access.js';
import {isSystemOwnerEmail} from '../src/system-account-exclusions.js';
import {canReclassifyFirstLoginCohort} from '../src/management-first-login-cohort.js';

const permissions = new Set(['checklistRead','checklistWrite','checklistSign','checklistManage','eventsRead','eventsWrite','eventsManage','eventsCatalogManage','scheduleRead','scheduleWrite','trainingsRead','trainingsManage','managementModuleEnabled','performanceModuleEnabled','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead','managementIndicatorsWrite','managementPlansManage','documentsManage','qualityManage','equipmentManage','peopleManage','financeRead','financeWrite','financeManage','notificationsRead','notificationsManage','occurrencesRead','occurrencesWrite','occurrencesAuditRead','usersManage','admin']);
const roles = new Set(['coordenador','conselho_diretor','gestor','anestesiologista','residente','temporario','administrador_app']);
const independentGrants = ['labelsRead','labelsWrite','labelsManage','checklistRead','checklistWrite','checklistSign','checklistManage'];
const fail = (code,status=400) => { throw Object.assign(Error(code),{code,status}); };
const email = value => String(value || '').trim().toLowerCase();
const uidValid = value => typeof value === 'string' && /^[^\s/]{1,128}$/.test(value);
const admin = actor => actor.profile.role === 'administrador_app' || actor.profile.permissions?.admin === true;
const version = row => Number.isSafeInteger(row?.version) && row.version >= 0 ? row.version : 0;
const getMany=(reader,keys)=>reader.getMany?reader.getMany(keys):Promise.all(keys.map(([collection,id])=>reader.get(collection,id)));
function authorize(actor,action) {
  const p=actor?.profile,l=actor?.identityLink;
  if(!uidValid(actor?.uid)||!uidValid(actor?.fiUid)||!l||l.active!==true||l.faUid!==actor.uid||l.fiUid!==actor.fiUid||email(l.email)!==email(actor.email)||!email(actor.email)||p?.uid!==actor.fiUid||email(p.email)!==email(actor.email)||p.active!==true||p.access!==true) fail('FI_ADMIN_FORBIDDEN',403);
  const permission=action.startsWith('people.')?'peopleManage':action.startsWith('admin.users.')||['admin.requests.list','admin.categories.list'].includes(action)?'usersManage':'admin';
  if(!admin(actor)&&p.permissions?.[permission]!==true)fail('FI_ADMIN_FORBIDDEN',403);
}
function contactInput(input) {
  if(!input||typeof input!=='object')fail('FI_ADMIN_CONTACT_INVALID');
  const sigla=String(input.sigla||'').trim().toUpperCase(),name=String(input.name||'').trim(),whatsAppLink=String(input.whatsAppLink||'').trim();
  if(!/^(?:[A-Z]{2}|L2)$/.test(sigla)||!name||name.length>120||typeof input.active!=='boolean'||(whatsAppLink&&!/^https:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?phone=\d+)$/.test(whatsAppLink)))fail('FI_ADMIN_CONTACT_INVALID');
  return {sigla,name,role:String(input.role||'').trim().slice(0,80),phone:String(input.phone||'').trim().slice(0,40),email:email(input.email).slice(0,200),whatsAppLink,crm:String(input.crm||'').trim().slice(0,40),entryDate:String(input.entryDate||'').trim().slice(0,32),active:input.active};
}
function expectVersion(current,expected) {
  if(!Number.isSafeInteger(expected)||expected<0)fail('FI_ADMIN_VERSION_REQUIRED');
  if(version(current)!==expected)fail('FI_ADMIN_STALE_VERSION',409);
}
function stamp(current,actor,time) {
  return {createdAt:current?.createdAt??time,createdByUid:current?.createdByUid??actor.uid,updatedAt:time,updatedByUid:actor.uid,version:version(current)+1};
}

/** All actor fields must originate in the worker's verified FA gate + FI identity lookup. */
export function createFiAdminService({store,projections={},now=Date.now}) {
  async function list(source,collection,cap=1000) {
    if(!source)fail('FI_ADMIN_PROJECTION_UNAVAILABLE',503);
    const rows=await source.list(collection,[],cap+1);if(rows.length>cap)fail('FI_ADMIN_CATALOG_LIMIT',409);return rows;
  }
  async function linked(targetUid,targetEmail,tx=store) {
    const link=await tx.get('fiAdminIdentityLinks',targetUid);
    if(!link||link.active!==true||link.faUid!==targetUid||!uidValid(link.fiUid)||email(link.email)!==email(targetEmail))fail('FI_ADMIN_IDENTITY_UNLINKED',409);
    return link;
  }
  async function project(jobId) {
    const job=await store.get('fiAdminOutbox',jobId);if(!job)fail('FI_ADMIN_JOB_MISSING',404);
    if(job.status==='applied')return {id:jobId,status:'applied'};
    try {
      const target=projections[job.target];if(!target)fail('FI_ADMIN_PROJECTION_UNAVAILABLE',503);
      await target.transaction(async tx=>{
        const snapshots=await getMany(tx,job.writes.map(w=>[w.collection,w.id]));
        for(let i=0;i<job.writes.length;i++) {
          const w=job.writes[i],old=snapshots[i];
          if(w.email&&email(old?.email)!==email(w.email))fail('FI_ADMIN_PROJECTION_IDENTITY_MISMATCH',409);
          if((old?.[w.versionField]||0)>=w.version)continue;
          let next;
          if(w.kind==='profile') {
            const grants={...w.data.permissions};for(const key of independentGrants){delete grants[key];if(typeof old?.permissions?.[key]==='boolean')grants[key]=old.permissions[key];}
            next={...old,...w.data,permissions:grants,createdAt:old?.createdAt??w.data.createdAt,firstLoginCohort:old?.firstLoginCohort??'REVIEW'};
          } else next={...(w.merge?old:{}),...w.data};
          await tx.set(w.collection,w.id,{...next,[w.versionField]:w.version});
        }
      });
      await store.transaction(async tx=>{const current=await tx.get('fiAdminOutbox',jobId);if(current)await tx.set('fiAdminOutbox',jobId,{...current,status:'applied',appliedAt:now()});});
      return {id:jobId,status:'applied'};
    } catch(error) {
      // The authoritative FI transaction is already committed. Keep a durable retry job.
      return {id:jobId,status:'pending',code:error.code||'FI_ADMIN_PROJECTION_PENDING'};
    }
  }
  async function commit(actor,action,target,mutate) {
    const jobId=crypto.randomUUID(),time=now();
    const result=await store.transaction(async tx=>{
      const {value,writes}=await mutate(tx,time);
      await tx.create('fiAdminOutbox',jobId,{id:jobId,action,target,writes,status:'pending',actorUid:actor.uid,actorFiUid:actor.fiUid,createdAt:time});
      await tx.create('fiAdminAudit',jobId,{id:jobId,action,target,actorUid:actor.uid,actorFiUid:actor.fiUid,resourceIds:writes.map(w=>`${w.collection}/${w.id}`),createdAt:time});
      return value;
    });
    return {...result,projection:await project(jobId)};
  }
  function contactWrites(record) {
    return [{collection:'contacts',id:record.sigla,data:record,version:record.version,versionField:'fiAdminVersion'},
      {collection:'eventMembers',id:record.sigla,data:{id:record.sigla,sigla:record.sigla,name:record.name,active:record.active,updatedByUid:record.updatedByUid,updatedAt:record.updatedAt},version:record.version,versionField:'fiAdminVersion'}];
  }
  async function execute({actor,action,input={}}) {
    authorize(actor,action);
    if(action==='people.list')return (await list(store,'contacts',400)).sort((a,b)=>a.sigla.localeCompare(b.sigla));
    if(action==='people.save') {
      const data=contactInput(input);
      return commit(actor,action,'FJ',async(tx,time)=>{
        const old=await tx.get('contacts',data.sigla);expectVersion(old,input.expectedVersion);
        const record={...data,...stamp(old,actor,time)};
        await tx.set('contacts',data.sigla,record);await tx.set('eventMembers',data.sigla,contactWrites(record)[1].data);
        return {value:{record:{id:data.sigla,...record}},writes:contactWrites(record)};
      });
    }
    if(action==='people.import') {
      const rows=input.records;if(!Array.isArray(rows)||!rows.length||rows.length>200||new Set(rows.map(r=>r?.sigla)).size!==rows.length)fail('FI_ADMIN_CONTACT_IMPORT_INVALID');
      const records=rows.map(contactInput);
      return commit(actor,action,'FJ',async(tx,time)=>{
        const old=await getMany(tx,records.map(r=>['contacts',r.sigla]));
        old.forEach((row,i)=>{if(!row)fail('FI_ADMIN_CONTACT_MISSING',409);expectVersion(row,rows[i].expectedVersion);});
        const writes=[];
        for(let i=0;i<records.length;i++) {
          const r=records[i],record={...old[i],name:r.name,email:r.email,phone:r.phone,active:r.active,...stamp(old[i],actor,time)};
          await tx.set('contacts',r.sigla,record);await tx.set('eventMembers',r.sigla,contactWrites(record)[1].data);writes.push(...contactWrites(record));
        }
        return {value:{updated:records.length,siglas:records.map(r=>r.sigla)},writes};
      });
    }
    if(action==='people.sync') {
      const rows=await list(store,'contacts',200);
      return commit(actor,action,'FJ',async tx=>{
        const records=await getMany(tx,rows.map(r=>['contacts',r.sigla]));
        if(records.some(r=>!r))fail('FI_ADMIN_STALE_VERSION',409);
        return {value:{count:records.length},writes:records.flatMap(contactWrites)};
      });
    }
    if(action==='admin.users.list')return (await list(store,'fiAdminUsers')).filter(row=>!isSystemOwnerEmail(row.email));
    if(action==='updates.users') {
      const rows=await list(projections.FA,'users');
      return rows.filter(row=>uidValid(row.id)&&row.uid===row.id&&row.active===true&&row.access===true&&!isSystemOwnerEmail(row.email))
        .map(({uid,email,displayName,sigla,active,access})=>({uid,email,displayName,sigla,active,access}));
    }
    if(action==='admin.categories.list')return list(store,'memberCategoryAssignments');
    if(action==='admin.requests.list')return (await list(projections.FA,'accessRequests')).filter(r=>r.status==='PENDING'&&!isSystemOwnerEmail(r.email));
    if(action==='admin.features.get'){const record=await store.get('appConfig','app');return {features:normalizeAppFeatures(record?.features||DEFAULT_APP_FEATURES),version:version(record)};}
    if(action==='admin.features.save') {
      const keys=Object.keys(DEFAULT_APP_FEATURES),features=input.features;
      if(!features||Object.keys(features).some(k=>!keys.includes(k))||keys.some(k=>typeof features[k]!=='boolean'))fail('FI_ADMIN_FEATURES_INVALID');
      return commit(actor,action,'FA',async(tx,time)=>{
        const old=await tx.get('appConfig','app');expectVersion(old,input.expectedVersion);
        const record={id:'app',features:normalizeAppFeatures(features),...stamp(old,actor,time)};await tx.set('appConfig','app',record);
        return {value:{features:record.features,version:record.version},writes:[{collection:'appConfig',id:'app',data:record,merge:true,version:record.version,versionField:'fiAdminVersion'}]};
      });
    }
    if(action==='admin.users.save') {
      if(input.uid===actor.uid)fail('FI_ADMIN_SELF_EDIT',403);
      const targetEmail=email(input.email),displayName=String(input.displayName||'').trim(),role=input.role;
      if(!uidValid(input.uid)||!/^\S+@\S+\.\S+$/.test(targetEmail)||!displayName||displayName.length>120||!roles.has(role)||isSystemOwnerEmail(targetEmail)||typeof input.active!=='boolean'||typeof input.access!=='boolean')fail('FI_ADMIN_USER_INVALID');
      if(!input.permissions||Array.isArray(input.permissions)||Object.entries(input.permissions).some(([key,value])=>!permissions.has(key)||typeof value!=='boolean'))fail('FI_ADMIN_PERMISSIONS_INVALID');
      const source=await projections.FA?.get('users',input.uid),pending=await projections.FA?.get('accessRequests',input.uid);
      if(source&&email(source.email)!==targetEmail)fail('FI_ADMIN_PROJECTION_IDENTITY_MISMATCH',409);
      if(!source&&email(pending?.email)!==targetEmail)fail('FI_ADMIN_PROJECTION_IDENTITY_MISMATCH',409);
      const newRequest=!source&&pending?.uid===input.uid&&pending.status==='PENDING'&&email(pending.email)===targetEmail;
      if(!source&&!newRequest)fail('FI_ADMIN_IDENTITY_UNLINKED',409);
      if(newRequest&&(await store.list('users',[{field:'email',op:'EQUAL',value:targetEmail}],3)).length)fail('FI_ADMIN_IDENTITY_UNLINKED',409);
      if(!admin(actor)&&(role==='administrador_app'||input.permissions.admin===true||input.permissions.usersManage===true||source?.role==='administrador_app'||source?.permissions?.admin===true||source?.permissions?.usersManage===true))fail('FI_ADMIN_FORBIDDEN',403);
      return commit(actor,action,'FA',async(tx,time)=>{
        const link=newRequest?await tx.get('fiAdminIdentityLinks',input.uid):await linked(input.uid,targetEmail,tx),old=await tx.get('fiAdminUsers',input.uid),local=newRequest?await tx.get('users',input.uid):null;expectVersion(old,input.expectedVersion);
        if(newRequest&&(link||old||local))fail('FI_ADMIN_IDENTITY_UNLINKED',409);
        const record={uid:input.uid,email:targetEmail,displayName,role,sigla:String(input.sigla||'').trim().toUpperCase().slice(0,20),phone:String(input.phone||'').trim().slice(0,40),active:input.active,access:input.access,permissions:withGeneralReadPermissions(Object.fromEntries(Object.entries(input.permissions).filter(([,v])=>v)),input),...stamp(old,actor,time)};
        if(newRequest){await tx.create('fiAdminIdentityLinks',input.uid,{faUid:input.uid,fiUid:input.uid,email:targetEmail,active:true,bindingMethod:'VERIFIED_FA_ACCESS_REQUEST'});await tx.create('users',input.uid,{...record,faUid:input.uid});}
        await tx.set('fiAdminUsers',input.uid,record);
        const writes=[{collection:'users',id:input.uid,data:record,kind:'profile',email:source?targetEmail:undefined,version:record.version,versionField:'fiAdminProfileVersion'}];
        // Omit undefined fields: Firestore REST accepts only serializable records.
        if(!source)delete writes[0].email;
        if(pending?.status==='PENDING')writes.push({collection:'accessRequests',id:input.uid,data:{status:'APPROVED',resolvedByUid:actor.uid,resolvedAt:time},merge:true,email:targetEmail,version:record.version,versionField:'fiAdminVersion'});
        return {value:{record:{id:input.uid,...record}},writes};
      });
    }
    if(action==='admin.users.cohort') {
      if(!uidValid(input.uid)||input.uid===actor.uid)fail('FI_ADMIN_SELF_EDIT',403);
      if(!admin(actor))fail('FI_ADMIN_FORBIDDEN',403);
      return commit(actor,action,'FA',async(tx,time)=>{
        const old=await tx.get('fiAdminUsers',input.uid);if(!old)fail('FI_ADMIN_USER_MISSING',404);await linked(input.uid,old.email,tx);expectVersion(old,input.expectedVersion);
        const source=await projections.FA.get('users',input.uid);if(!canReclassifyFirstLoginCohort(source?.firstLoginCohort,input.cohort))fail('FI_ADMIN_COHORT_PROTECTED',409);
        const record={...old,firstLoginCohort:input.cohort,...stamp(old,actor,time)};await tx.set('fiAdminUsers',input.uid,record);
        return {value:{uid:input.uid,firstLoginCohort:input.cohort,changed:source?.firstLoginCohort!==input.cohort},writes:[{collection:'users',id:input.uid,data:{firstLoginCohort:input.cohort,updatedAt:time},email:old.email,merge:true,version:record.version,versionField:'fiAdminCohortVersion'}]};
      });
    }
    if(action==='updates.read') {
      if(!uidValid(input.uid))fail('FI_ADMIN_USER_INVALID');
      const [profile,devices]=await Promise.all([projections.FA?.get('users',input.uid),list(projections.FA,`users/${input.uid}/appInstallations`,200)]);
      return {request:profile?.appUpdateRequest||null,devices};
    }
    if(['updates.request','updates.cancel','updates.batch'].includes(action)) {
      const uids=action==='updates.batch'?input.uids:[input.uid];
      if(input.target!=='FA'||!Array.isArray(uids)||!uids.length||uids.length>200||new Set(uids).size!==uids.length||uids.some(id=>!uidValid(id))||(action!=='updates.cancel'&&(!Number.isSafeInteger(input.minimumRelease)||input.minimumRelease<=0)))fail('FI_ADMIN_UPDATE_INVALID');
      const targets=await getMany(projections.FA,uids.map(id=>['users',id]));
      if(targets.some(p=>!p||p.active!==true||p.access!==true||isSystemOwnerEmail(p.email)))fail('FI_ADMIN_UPDATE_TARGET_INVALID',409);
      const requestId=crypto.randomUUID();
      return commit(actor,action,'FA',async(tx,time)=>{
        const old=await getMany(tx,uids.map(id=>['fiAdminUpdateRequests',id]));
        const request=action==='updates.cancel'?null:{id:requestId,target:'FA',minimumRelease:input.minimumRelease,requestedByUid:actor.uid,requestedAt:time};
        const writes=[];
        for(let i=0;i<uids.length;i++) {
          const record={uid:uids[i],request,...stamp(old[i],actor,time)};await tx.set('fiAdminUpdateRequests',uids[i],record);
          writes.push({collection:'users',id:uids[i],data:{appUpdateRequest:request},email:targets[i].email,merge:true,version:record.version,versionField:'fiAdminUpdateVersion'});
        }
        return {value:{id:requestId,count:uids.length,request},writes};
      });
    }
    if(action==='admin.projections.retry') {
      if(!uidValid(input.id))fail('FI_ADMIN_JOB_INVALID');return {projection:await project(input.id)};
    }
    fail('FI_ADMIN_ACTION_UNKNOWN',404);
  }
  return {execute};
}
