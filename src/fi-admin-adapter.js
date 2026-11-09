const fail=code=>Object.assign(Error(code),{code});
export function createFiAdminAdapter({request,getActorUid}){
 let currentUid=null,contacts=new Map(),users=new Map(),featureVersion;
 async function call(action,input={},uid){const actual=await getActorUid();if(!actual||uid&&actual!==uid)throw fail('FI_SESSION_CHANGED');if(currentUid!==actual){contacts.clear();users.clear();featureVersion=undefined;currentUid=actual;}const r=await request(action,input,actual);if(await getActorUid()!==actual)throw fail('FI_SESSION_CHANGED');if(r?.projection?.status==='pending'){const error=fail('FI_PROJECTION_PENDING');error.jobId=r.projection.id;throw error;}return r;}
 return {
  async listContactCatalog({uid}={}){const rows=await call('people.list',{},uid);contacts=new Map(rows.map(r=>[r.sigla,r]));return rows;},
  async saveContact(input,uid){const r=await call('people.save',{...input,expectedVersion:contacts.get(input.sigla)?.version||0},uid);contacts.set(input.sigla,r.record);return r.record;},
  async updateContactRegistrationFields(records,uid){const r=await call('people.import',{records:records.map(row=>({...contacts.get(row.sigla),...row,expectedVersion:contacts.get(row.sigla)?.version||0}))},uid);contacts.clear();return r;},
  async syncEventMemberDirectory(uid){return (await call('people.sync',{},uid)).count;},
  async listUserProfiles(){const rows=await call('admin.users.list');users=new Map(rows.map(r=>[r.uid,r]));return rows;},
  async listAccessRequests(){return call('admin.requests.list');},
  async listMemberCategoryAssignments(){return call('admin.categories.list');},
  async saveUserProfile(input,uid){const r=await call('admin.users.save',{...input,expectedVersion:users.get(input.uid)?.version||0},uid);users.set(input.uid,r.record);return r.record;},
  async setFirstLoginCohort(uid,cohort){const r=await call('admin.users.cohort',{uid,cohort,expectedVersion:users.get(uid)?.version||0});users.clear();return r;},
  async readAppFeatures(uid){const r=await call('admin.features.get',{},uid);featureVersion=r.version;return r.features;},
  async saveAppFeatures(features,uid){if(featureVersion===undefined)throw fail('FI_RELOAD_REQUIRED');const r=await call('admin.features.save',{features,expectedVersion:featureVersion},uid);featureVersion=r.version;return r.features;},
  readUserAppUpdates:(actorUid,uid)=>call('updates.read',{uid},actorUid),
  requestUserAppUpdate:(actorUid,uid,minimumRelease)=>call('updates.request',{uid,minimumRelease,target:'FA'},actorUid),
  cancelUserAppUpdate:(actorUid,uid)=>call('updates.cancel',{uid,target:'FA'},actorUid),
  listAppUpdateUsers:actorUid=>call('updates.users',{},actorUid),
  sendAppUpdateBatch:(actorUid,uids,minimumRelease)=>call('updates.batch',{uids,minimumRelease,target:'FA'},actorUid)
 };
}
