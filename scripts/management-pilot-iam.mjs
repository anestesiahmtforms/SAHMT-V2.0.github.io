import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openPrivateJson, sealPrivateJson} from './lib/windows-protected-json.js';

// Read-only by default. Mutation commands require --confirm-iam-change and
// specific human approval. No Firebase users, data, Rules, billing or APIs change.
// Exact permission mapping: https://docs.cloud.google.com/firestore/native/docs/security/iam
// Database condition: https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions
const MEMBER = process.env.SAHMT_PILOT_ADMIN_PRINCIPAL || 'user:pilot-admin@example.invalid';
const TARGETS = Object.freeze({
  FB: {project:'sahmt-gestao-5ae66',owner:process.env.SAHMT_FB_OWNER_EMAIL || 'fb-owner@example.invalid'},
  FC: {project:'indicadores---sahmt',owner:process.env.SAHMT_FC_OWNER_EMAIL || 'fc-owner@example.invalid'}
});
const clone = value => JSON.parse(JSON.stringify(value));
const same = isDeepStrictEqual;
const fail = code => { throw Object.assign(new Error(code), {safeCode:code}); };
const sorted = values => [...values].sort();

export function pilotIamPlan(alias) {
  const target=TARGETS[alias]; if(!target)fail('IAM_TARGET_INVALID');
  const specs=[{roleId:'sahmtGatewayAuthLookup',title:'SAHMT Gateway Auth Lookup',
    permissions:['firebaseauth.users.get']}];
  if(alias==='FB')specs.push({roleId:'sahmtGatewayLeaseAccess',title:'SAHMT Gateway Lease Access',
    permissions:['datastore.databases.get','datastore.entities.get','datastore.entities.create','datastore.entities.update'],
    condition:{title:'SAHMT_Gateway_Default_Database',description:'Gateway lease access restricted to the default FB database.',
      expression:'resource.name == "projects/'+target.project+'/databases/(default)"'}});
  return {...target,alias,member:MEMBER,roles:specs.map(s=>({...s,name:'projects/'+target.project+'/roles/'+s.roleId}))};
}

export function exactPilotRole(role,spec) {
  return role && role.name===spec.name && role.deleted!==true && role.stage!=='DISABLED'
    && Array.isArray(role.includedPermissions) && same(sorted(role.includedPermissions),sorted(spec.permissions));
}
const bindingMatches=(binding,spec)=>binding.role===spec.name && same(binding.condition??null,spec.condition??null);
const includesMember=(policy,spec)=>policy.bindings?.some(b=>bindingMatches(b,spec)&&b.members?.includes(MEMBER))===true;

export function mergePilotBindings(policy,plan,{rollback=false,originalPolicy}={}) {
  if(!policy || typeof policy.etag!=='string' || !policy.etag || !Array.isArray(policy.bindings??[]))fail('IAM_POLICY_INVALID');
  const result=clone(policy);result.version=3;result.bindings??=[];
  for(const spec of plan.roles){
    const indexes=result.bindings.map((b,i)=>bindingMatches(b,spec)?i:-1).filter(i=>i>=0);
    if(indexes.length>1)fail('IAM_BINDING_AMBIGUOUS');
    if(rollback){
      if(!originalPolicy)fail('IAM_BACKUP_INVALID');
      if(includesMember(originalPolicy,spec))continue;
      if(indexes.length){const b=result.bindings[indexes[0]];b.members=b.members.filter(m=>m!==MEMBER);if(!b.members.length)result.bindings.splice(indexes[0],1);}
    }else if(indexes.length){
      const b=result.bindings[indexes[0]];if(!Array.isArray(b.members))fail('IAM_POLICY_INVALID');
      if(!b.members.includes(MEMBER))b.members.push(MEMBER);
    }else result.bindings.push({role:spec.name,members:[MEMBER],...(spec.condition?{condition:clone(spec.condition)}:{})});
  }
  return {policy:result,changed:!same(result.bindings,policy.bindings??[])};
}

export function createPilotIamApi({token,fetchImpl=globalThis.fetch,allowWrites=false}) {
  if(typeof token!=='string'||!token)fail('IAM_OAUTH_UNAVAILABLE');
  const request=async(method,url,body,{write=false,allowMissing=false}={})=>{
    if(write&&!allowWrites)fail('IAM_WRITE_NOT_AUTHORIZED');
    let response;
    try {response=await fetchImpl(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch {fail('IAM_NETWORK_FAILED');}
    if(allowMissing&&response.status===404)return null;
    if(!response.ok)throw Object.assign(new Error('IAM_HTTP_ERROR'),{safeCode:'IAM_HTTP_ERROR',httpStatus:response.status});
    try{return await response.json();}catch{fail('IAM_RESPONSE_INVALID');}
  };
  const projectUrl=plan=>'https://cloudresourcemanager.googleapis.com/v1/projects/'+plan.project;
  return Object.freeze({
    getPolicy:plan=>request('POST',projectUrl(plan)+':getIamPolicy',{options:{requestedPolicyVersion:3}}),
    getRole:spec=>request('GET','https://iam.googleapis.com/v1/'+spec.name,undefined,{allowMissing:true}),
    createRole:(plan,spec)=>request('POST','https://iam.googleapis.com/v1/projects/'+plan.project+'/roles',
      {roleId:spec.roleId,role:{title:spec.title,description:'Dedicated SAHMT Gateway permission; no user administration or service account keys.',
        stage:'GA',includedPermissions:spec.permissions}},{write:true}),
    setPolicy:(plan,policy)=>request('POST',projectUrl(plan)+':setIamPolicy',{policy,updateMask:'bindings,etag,version'},{write:true}),
    deleteRole:(spec,etag)=>request('DELETE','https://iam.googleapis.com/v1/'+spec.name+'?etag='+encodeURIComponent(etag),undefined,{write:true})
  });
}

export async function inspectPilotIam(api,plan) {
  const policy=await api.getPolicy(plan),roles=[];
  mergePilotBindings(policy,plan);
  for(const spec of plan.roles){const existing=await api.getRole(spec);if(existing&&!exactPilotRole(existing,spec))fail('IAM_EXISTING_ROLE_MISMATCH');roles.push({spec,existing});}
  return {schemaVersion:1,projectAlias:plan.alias,project:plan.project,member:MEMBER,originalPolicy:policy,roles,
    createdRoles:[],applied:false,rolledBack:false};
}

export async function applyPilotIam(api,plan,state,persist) {
  if(state.project!==plan.project||state.member!==MEMBER)fail('IAM_BACKUP_INVALID');
  await persist(state); // Encrypted recovery material exists before the first change.
  for(const item of state.roles){
    const current=await api.getRole(item.spec);
    if(current){if(!exactPilotRole(current,item.spec))fail('IAM_EXISTING_ROLE_MISMATCH');continue;}
    if(item.existing)fail('IAM_ROLE_CHANGED');
    state.pendingRoleCreate=item.spec.name;await persist(state);
    const created=await api.createRole(plan,item.spec);if(!exactPilotRole(created,item.spec))fail('IAM_ROLE_VERIFICATION_FAILED');
    state.createdRoles.push(item.spec.name);delete state.pendingRoleCreate;await persist(state);
  }
  const latest=await api.getPolicy(plan);const merged=mergePilotBindings(latest,plan);
  // Preserve the immediately preceding policy for conflict-safe rollback.
  state.beforeBindingPolicy=clone(latest);state.pendingBindingWrite=merged.changed;await persist(state);
  if(merged.changed)await api.setPolicy(plan,merged.policy);
  const after=await api.getPolicy(plan);
  if(plan.roles.some(spec=>!includesMember(after,spec)))fail('IAM_BINDING_VERIFICATION_FAILED');
  state.applied=true;state.pendingBindingWrite=false;await persist(state);
  return {code:'PILOT_IAM_APPLIED',projectAlias:plan.alias,roles:plan.roles.length};
}

export async function rollbackPilotIam(api,plan,state,persist) {
  if(state.project!==plan.project||state.member!==MEMBER||!Array.isArray(state.createdRoles))fail('IAM_BACKUP_INVALID');
  if(state.pendingRoleCreate)fail('IAM_CREATE_OUTCOME_REVIEW_REQUIRED');
  const current=await api.getPolicy(plan);
  const merged=mergePilotBindings(current,plan,{rollback:true,originalPolicy:state.beforeBindingPolicy??state.originalPolicy});
  if(merged.changed)await api.setPolicy(plan,merged.policy);
  const after=await api.getPolicy(plan);
  for(const name of state.createdRoles){
    const spec=plan.roles.find(s=>s.name===name);if(!spec)fail('IAM_BACKUP_INVALID');
    // Leave a role used by another member untouched. Removing our binding is sufficient to revoke our grant.
    if(after.bindings?.some(b=>b.role===name&&b.members?.length))continue;
    const role=await api.getRole(spec);if(!role||role.deleted)continue;
    if(!exactPilotRole(role,spec)||typeof role.etag!=='string')fail('IAM_ROLE_CHANGED');
    await api.deleteRole(spec,role.etag);
  }
  state.rolledBack=true;await persist(state);
  return {code:'PILOT_IAM_ROLLED_BACK',projectAlias:plan.alias};
}

async function main(args) {
  const [mode='plan',alias='FB',...options]=args;
  if(!['plan','inspect','apply','rollback'].includes(mode))fail('IAM_COMMAND_INVALID');
  const plan=pilotIamPlan(alias);
  if(mode==='plan')return {code:'PILOT_IAM_PLAN',projectAlias:alias,roles:plan.roles.map(({roleId,permissions,condition})=>({roleId,permissions,...(condition?{condition}: {})}))};
  const write=mode==='apply'||mode==='rollback';
  if(write&&!options.includes('--confirm-iam-change'))fail('IAM_WRITE_NOT_AUTHORIZED');
  const backupIndex=options.indexOf('--backup');
  if(options.some((v,i)=>v!=='--confirm-iam-change'&&v!=='--backup'&&!(backupIndex>=0&&i===backupIndex+1)))fail('IAM_ARGUMENT_INVALID');
  if(mode==='rollback'&&(backupIndex<0||!options[backupIndex+1]))fail('IAM_BACKUP_REQUIRED');
  const require=createRequire(import.meta.url),auth=require('../node_modules/firebase-tools/lib/auth.js');
  const account=auth.getAllAccounts().find(a=>a.user?.email===plan.owner&&a.tokens?.refresh_token);
  if(!account)fail('IAM_OWNER_SESSION_REQUIRED');
  const credential=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  const api=createPilotIamApi({token:credential.access_token,allowWrites:write});
  if(!process.env.LOCALAPPDATA)fail('IAM_PRIVATE_DIRECTORY_REQUIRED');
  const directory=path.join(process.env.LOCALAPPDATA,'SAHMT','management-pilot-iam');await mkdir(directory,{recursive:true});
  let backupFile,state;
  if(mode==='rollback'){
    backupFile=path.resolve(options[backupIndex+1]);
    if(path.dirname(backupFile).toLowerCase()!==path.resolve(directory).toLowerCase())fail('IAM_BACKUP_PATH_INVALID');
    state=await openPrivateJson(JSON.parse(await readFile(backupFile,'utf8')));
  }else{
    state=await inspectPilotIam(api,plan);
    backupFile=path.join(directory,alias+'-'+Date.now()+'-'+randomUUID()+'.dpapi.json');
  }
  let initial=true;
  const persist=async value=>{
    const sealed=JSON.stringify(await sealPrivateJson(value));
    if(initial&&mode!=='rollback')await writeFile(backupFile,sealed,{flag:'wx'});
    else {const temp=backupFile+'.'+randomUUID()+'.tmp';await writeFile(temp,sealed,{flag:'wx'});await rename(temp,backupFile);}
    initial=false;
  };
  if(mode==='inspect'){await persist(state);return {code:'PILOT_IAM_INSPECTED',projectAlias:alias,rolesExisting:state.roles.filter(r=>r.existing).length,
    rolesToCreate:state.roles.filter(r=>!r.existing).length,bindingsToAdd:plan.roles.filter(s=>!includesMember(state.originalPolicy,s)).length,backupFile};}
  const result=mode==='apply'?await applyPilotIam(api,plan,state,persist):await rollbackPilotIam(api,plan,state,persist);
  return {...result,backupFile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.log(JSON.stringify({code:typeof error?.safeCode==='string'?error.safeCode:'PILOT_IAM_FAILED',...(Number.isInteger(error?.httpStatus)?{httpStatus:error.httpStatus}:{})}));process.exitCode=1;
  });
}
