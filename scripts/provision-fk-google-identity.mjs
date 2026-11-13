// Preview/apply same-UID Google Auth identities from FA into the standalone FK project.
// Only active EFETIVO users plus the two explicitly designated function accounts qualify.
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

const source='sahmt-17a16',destination='sahmt-funcional-fk';
const sourceEmail='anestesiahmtforms@gmail.com',destinationEmail='anestesiahmtaula@gmail.com';
const identity='https://identitytoolkit.googleapis.com',firebase='https://firebase.googleapis.com/v1beta1/projects/';
const authConfig=project=>identity+'/admin/v2/projects/'+project;
const accounts=project=>identity+'/v1/projects/'+project+'/accounts:';
const providerPath='/defaultSupportedIdpConfigs/google.com';
const domain='anestesiahmtforms.github.io';
const apply=process.argv.includes('--apply');
const demand=(condition,code)=>{if(!condition)throw Error(code);};

async function api(url,token,body,method='GET',missing=false){
  let response;
  try{response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('FK_API_UNAVAILABLE');}
  if(missing&&response.status===404){await response.body?.cancel();return null;}
  if(!response.ok){await response.body?.cancel();throw Error('FK_API_'+response.status);}
  return response.json();
}
async function listUsers(project,token){
  const users=[];let nextPageToken;
  do{const query=new URLSearchParams({maxResults:'1000'});if(nextPageToken)query.set('nextPageToken',nextPageToken);
    const result=await api(accounts(project)+'batchGet?'+query,token);users.push(...(result.users||[]));nextPageToken=result.nextPageToken;
  }while(nextPageToken);return users;
}
const decode=value=>value?.mapValue?Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([key,item])=>[key,decode(item)])):
  value?.arrayValue?(value.arrayValue.values||[]).map(decode):value?.stringValue??value?.booleanValue??
    (value?.integerValue!==undefined?Number(value.integerValue):value?.timestampValue??null);
function firestoreRoot(project){return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/`;}
async function firestoreDocument(project,path,token){
  const url=firestoreRoot(project)+path.split('/').map(encodeURIComponent).join('/');
  const result=await api(url,token,undefined,'GET',true);return result?decode({mapValue:{fields:result.fields||{}}}):null;
}
function googleProvider(user){const rows=(user.providerUserInfo||[]).filter(row=>row.providerId==='google.com');
  demand(rows.length===1,'FK_SOURCE_GOOGLE_LINK_INVALID');return rows[0];}
function canonical(user){
  const provider=googleProvider(user);demand(user.emailVerified===true&&!user.disabled&&typeof user.email==='string','FK_SOURCE_ACCOUNT_INACTIVE');
  demand(typeof user.localId==='string'&&/^[^/\s]{1,128}$/.test(user.localId),'FK_SOURCE_UID_INVALID');
  const result={localId:user.localId,email:user.email.trim().toLowerCase(),emailVerified:true,disabled:false,
    providerUserInfo:[{providerId:'google.com',rawId:provider.rawId,email:provider.email||user.email}]};
  if(user.displayName)result.displayName=user.displayName;
  demand(typeof provider.rawId==='string'&&provider.rawId,'FK_SOURCE_GOOGLE_LINK_INVALID');return result;
}
const email=user=>user.email?.trim().toLowerCase();
const uid=user=>user.localId;
const googleId=user=>user.providerUserInfo?.find(row=>row.providerId==='google.com')?.rawId;
function unique(rows,key,code){const seen=new Set();for(const row of rows){const value=key(row);if(!value)continue;demand(!seen.has(value),code);seen.add(value);}}
function matching(left,right){return uid(left)===uid(right)&&email(left)===email(right)&&googleId(left)===googleId(right)&&
  left.emailVerified===right.emailVerified&&Boolean(left.disabled)===Boolean(right.disabled);}

try{
  const mode=process.argv.find(value=>['preview','verify'].includes(value))||'preview';
  const [fa,fk]=await Promise.all([firebaseCliAccountToken(sourceEmail),firebaseCliAccountToken(destinationEmail)]);
  const [project,billing,databases,sourceProvider,currentConfig,sourceUsers]=await Promise.all([
    api(firebase+destination,fk),
    api('https://cloudbilling.googleapis.com/v1/projects/'+destination+'/billingInfo',fk),
    api('https://firestore.googleapis.com/v1/projects/'+destination+'/databases',fk),
    api(authConfig(source)+providerPath,fa),
    api(authConfig(destination)+'/config',fk,undefined,'GET',true),
    listUsers(source,fa)
  ]);
  demand(project.projectId===destination&&project.state==='ACTIVE','FK_PROJECT_ID_MISMATCH');
  demand(billing.billingEnabled===false,'FK_MUST_REMAIN_SPARK');
  demand(databases.databases?.length===1&&databases.databases[0].name===`projects/${destination}/databases/(default)`&&
    databases.databases[0].type==='FIRESTORE_NATIVE','FK_DEFAULT_FIRESTORE_REQUIRED');
  demand(sourceProvider.enabled===true&&sourceProvider.clientId&&sourceProvider.clientSecret,'FA_GOOGLE_PROVIDER_REQUIRED');
  demand(currentConfig,'FK_FIREBASE_AUTH_NOT_ENABLED');

  const allowed=[];let team=0,designated=0;
  for(const raw of sourceUsers){
    if(!raw.email||!(raw.providerUserInfo||[]).some(row=>row.providerId==='google.com'))continue;
    const account=canonical(raw),address=email(account);
    const profile=await firestoreDocument(source,`users/${uid(account)}`,fa);
    if(!profile||profile.uid!==uid(account)||email(profile)!==address||profile.active!==true||profile.access!==true)continue;
    if(address==='wx2064@gmail.com'){
      allowed.push(account);designated++;continue;
    }
    if(address==='marcio.henrique82@gmail.com'){
      if(profile.role==='gestor'){allowed.push(account);designated++;}
      continue;
    }
    const categoryId=createHash('sha256').update(JSON.stringify(address)).digest('hex');
    const assignment=await firestoreDocument(source,`userCategories/${categoryId}`,fa);
    const affiliations=Array.isArray(assignment?.memberCategories)?assignment.memberCategories.filter(value=>
      ['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'].includes(value)):[];
    if(assignment?.schemaVersion===1&&assignment.identityStatus==='LINKED'&&assignment.uid===uid(account)&&
      email(assignment)===address&&Array.isArray(assignment.memberCategories)&&
      new Set(assignment.memberCategories).size===assignment.memberCategories.length&&affiliations.length===1&&affiliations[0]==='EFETIVO'){
      allowed.push(account);team++;
    }
  }
  demand(allowed.length>0,'FK_ALLOWED_SOURCE_USERS_EMPTY');
  unique(allowed,uid,'FK_SOURCE_UID_DUPLICATE');unique(allowed,email,'FK_SOURCE_EMAIL_DUPLICATE');unique(allowed,googleId,'FK_SOURCE_GOOGLE_DUPLICATE');
  const before=await listUsers(destination,fk);
  unique(before,uid,'FK_DESTINATION_UID_DUPLICATE');unique(before,email,'FK_DESTINATION_EMAIL_DUPLICATE');unique(before,googleId,'FK_DESTINATION_GOOGLE_DUPLICATE');
  const sourceByUid=new Map(allowed.map(row=>[uid(row),row]));
  demand(before.every(row=>{
    const expected=sourceByUid.get(uid(row));if(!expected)return false;
    const providers=row.providerUserInfo||[];
    const otherProvider=providers.some(provider=>provider.providerId!=='google.com');
    const google=providers.filter(provider=>provider.providerId==='google.com');
    const noPassword=!(row.passwordHash||row.salt);
    return !otherProvider&&noPassword&&(!email(row)||email(row)===email(expected))&&
      (google.length===0||google.length===1&&google[0].rawId===googleId(expected));
  }),'FK_DESTINATION_ACCOUNT_CONFLICT');
  const beforeByUid=new Map(before.map(row=>[uid(row),row]));
  const changes=allowed.filter(row=>!beforeByUid.has(uid(row))||!matching(row,beforeByUid.get(uid(row))));
  const authorizedDomains=[...new Set([...(currentConfig.authorizedDomains||[]),domain,'localhost'])];
  const provider=await api(authConfig(destination)+providerPath,fk,undefined,'GET',true);
  const summary={projectId:destination,sourceProjectId:source,billingEnabled:false,activeEffectiveUsers:team,
    designatedAccounts:designated,existingTargetAccounts:before.length,accountsToLinkOrImport:changes.length,
    googleProviderReady:Boolean(provider?.enabled&&provider.clientId===sourceProvider.clientId),
    signupDisabled:currentConfig.client?.permissions?.disabledUserSignup===true,
    authorizedOriginPresent:authorizedDomains.includes(domain)};

  if(mode==='verify'){
    const after=before;
    demand(after.length===allowed.length&&allowed.every(row=>matching(row,after.find(item=>uid(item)===uid(row))||{}))&&
      provider?.enabled&&provider.clientId===sourceProvider.clientId&&currentConfig.client?.permissions?.disabledUserSignup===true&&
      currentConfig.authorizedDomains?.includes(domain),'FK_IDENTITY_NOT_READY');
    console.log(JSON.stringify({code:'FK_GOOGLE_UIDS_VERIFIED',...summary,uidAndProviderMatches:true}));
  }else if(apply){
    const configBody={authorizedDomains,client:{permissions:{disabledUserSignup:true}}};
    await api(authConfig(destination)+'/config?updateMask=authorizedDomains,client.permissions.disabledUserSignup',fk,configBody,'PATCH');
    const providerBody={enabled:true,clientId:sourceProvider.clientId,clientSecret:sourceProvider.clientSecret};
    const providerPathUrl=authConfig(destination)+providerPath;
    if(provider){
      if(!provider.enabled||provider.clientId!==sourceProvider.clientId)
        await api(providerPathUrl+'?updateMask=enabled,clientId,clientSecret',fk,providerBody,'PATCH');
    }else await api(authConfig(destination)+'/defaultSupportedIdpConfigs?idpId=google.com',fk,providerBody,'POST');
    for(let offset=0;offset<changes.length;offset+=1000){
      const result=await api(accounts(destination)+'batchCreate',fk,{hashAlgorithm:'BCRYPT',sanityCheck:true,allowOverwrite:true,
        users:changes.slice(offset,offset+1000)},'POST');
      demand(!(result.error?.length||result.errors?.length||result.failureCount),'FK_IMPORT_PARTIAL_STOP');
    }
    const [after,afterConfig,afterProvider]=await Promise.all([listUsers(destination,fk),
      api(authConfig(destination)+'/config',fk),api(authConfig(destination)+providerPath,fk)]);
    demand(after.length===allowed.length&&allowed.every(row=>matching(row,after.find(item=>uid(item)===uid(row))||{}))&&
      afterConfig.client?.permissions?.disabledUserSignup===true&&afterConfig.authorizedDomains?.includes(domain)&&
      afterProvider.enabled&&afterProvider.clientId===sourceProvider.clientId,'FK_UID_GOOGLE_LINK_READBACK_FAILED');
    console.log(JSON.stringify({code:'FK_GOOGLE_UIDS_LINKED',...summary,createdOrLinked:changes.length,uidAndProviderVerified:true}));
  }else{
    console.log(JSON.stringify({code:changes.length||!summary.googleProviderReady||!summary.signupDisabled||!summary.authorizedOriginPresent?
      'FK_SETUP_REQUIRED':'FK_GOOGLE_UIDS_READY',...summary}));
  }
}catch(error){
  console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'FK_GOOGLE_PROVISIONING_FAILED');process.exitCode=1;
}
