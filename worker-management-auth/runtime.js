import {createManagementAuthBroker} from '../scripts/lib/management-auth-broker.js';
import {createManagementGoogleAuthAdapter} from '../scripts/lib/management-google-auth-adapter.js';
import {createManagementFaFirstLoginBroker} from '../scripts/lib/management-fa-first-login.js';
import {createGoogleIdTokenVerifier} from '../scripts/lib/google-id-token-verifier.js';
import {MANAGEMENT_SIGNERS, MANAGEMENT_POLICY_VERSION} from '../scripts/lib/management-gateway-config-preparation.js';
import {createManagementAppsScriptGatewayFromEnv} from './apps-script-gateway-adapter.js';
import {createManagementAuthWorkerRuntime} from './admission-state.js';
import {sanitizedManagementPilotDiagnostic} from '../src/firebase-project-broker-errors.js';

// The FB path deliberately retains all thirteen fresh Gateway round trips.
// Bound the whole exchange separately from each individual Google request.
export const MANAGEMENT_RUNTIME_DEFAULTS = Object.freeze({maxConcurrent:8,maxRequestMs:80000,cleanupDrainMs:10000,
  leaseDurationMs:300000,maxSnapshotAgeMs:30000,maxExecutionMs:60000,cleanupTimeoutMs:10000,maxFutureSkewMs:5000});
const PROJECTS=Object.freeze({FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt'});
const flag=(env,name)=>{ if(env[name]!==undefined && !['true','false'].includes(env[name]))throw Error('WORKER_FLAG_INVALID');return env[name]==='true'; };
const safeCode=(value,fallback)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value)?value:fallback;
export function parseManagementPilotUidAllowlist(env, pilotOnly) {
  const raw = env.MANAGEMENT_AUTH_PILOT_UIDS_JSON;
  if (!pilotOnly) {
    if (raw !== undefined) throw Error('WORKER_PILOT_POLICY_INVALID');
    return null;
  }
  if (typeof raw !== 'string' || raw.length > 256) throw Error('WORKER_PILOT_POLICY_INVALID');
  let values;
  try { values = JSON.parse(raw); } catch { throw Error('WORKER_PILOT_POLICY_INVALID'); }
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string'
    || values[0].length < 1 || values[0].length > 128 || /[\s/\x00-\x1f]/.test(values[0]))
    throw Error('WORKER_PILOT_POLICY_INVALID');
  return Object.freeze(values.slice());
}

export function parseManagementPilotOrigin(env, pilotOnly) {
  const origin = env.MANAGEMENT_AUTH_PILOT_ORIGIN;
  if (origin === undefined) return undefined;
  if (!pilotOnly || typeof origin !== 'string') throw Error('WORKER_PILOT_ORIGIN_INVALID');
  let url;
  try { url = new URL(origin); } catch { throw Error('WORKER_PILOT_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.hostname.includes('*'))
    throw Error('WORKER_PILOT_ORIGIN_INVALID');
  return origin;
}

/** Concrete production composition; dependency substitution is only for local tests. */
export function buildManagementAuthRuntime(env,{fetchImpl=globalThis.fetch,now=Date.now}={}) {
  if(!env || !flag(env,'MANAGEMENT_AUTH_ENABLED'))throw Error('WORKER_RUNTIME_DISABLED');
  const enabled={FB:flag(env,'MANAGEMENT_AUTH_FB_ENABLED'),FC:flag(env,'MANAGEMENT_AUTH_FC_ENABLED')};
  const firstLoginEnabled=flag(env,'MANAGEMENT_FIRST_LOGIN_ENABLED');
  const pilotOnly=flag(env,'MANAGEMENT_AUTH_PILOT_ONLY');
  const fcPilotProvision=flag(env,'MANAGEMENT_AUTH_FC_PILOT_PROVISION');
  const pilotAllowlist=parseManagementPilotUidAllowlist(env,pilotOnly);
  const pilotOrigin=parseManagementPilotOrigin(env,pilotOnly);
  if(fcPilotProvision&&(!pilotOnly||!enabled.FC||pilotAllowlist?.length!==1))throw Error('WORKER_FC_PILOT_PROVISION_INVALID');
  if(!enabled.FB&&!enabled.FC&&!firstLoginEnabled)throw Error('WORKER_TARGETS_DISABLED');
  const gateway=createManagementAppsScriptGatewayFromEnv({env,stateBinding:env.BROKER_STATE,fetchImpl,clock:now});
  if(gateway.enabled!==true)throw Error('WORKER_GATEWAY_REQUIRED');
  let policy;try{policy=JSON.parse(env.MANAGEMENT_GATEWAY_POLICY_JSON);}catch{throw Error('WORKER_GATEWAY_POLICY_INVALID');}
  const required=['AUTH_USER_LOOKUP_FA','READ_FA_AUTHORIZATION',
    ...(enabled.FB?['AUTH_USER_LOOKUP_FB','SIGN_FB_CUSTOM_TOKEN','READ_FB_LEASE','WRITE_FB_LEASE','INVALIDATE_FB_LEASE']:[]),
    ...(enabled.FC?['AUTH_USER_LOOKUP_FC','SIGN_FC_CUSTOM_TOKEN']:[]),...(firstLoginEnabled?['FIRST_LOGIN_FA_SIGN']:[])];
  if(required.some(op=>policy.enabledOperations?.[op]!==true))throw Error('WORKER_GATEWAY_OPERATION_DISABLED');
  const auth=createManagementGoogleAuthAdapter({enabled:true,fetchImpl,privilegedGateway:gateway,pilotDiagnostics:pilotOnly,
    signerServiceAccountEmail:MANAGEMENT_SIGNERS.FB,fcSignerServiceAccountEmail:MANAGEMENT_SIGNERS.FC,clock:now,
    policy:{operationTimeoutMs:15000,maxResponseBytes:65536,maxResponseChunks:128,maxKeyCacheMs:3600000,
      maxFutureSkewMs:5000,maxIdTokenLifetimeSeconds:3600,customTokenLifetimeSeconds:600}});
  const brokerPolicy={schemaVersion:1,version:MANAGEMENT_POLICY_VERSION,...MANAGEMENT_RUNTIME_DEFAULTS,
    readBudget:{mode:'REQUEST_BOUNDED',maxReadsPerExchange:32}};
  const adapters={...auth,readFaAuthorization:gateway.readFaAuthorization,readFbLease:gateway.readFbLease,
    writeFbLease:gateway.writeFbLease,invalidateFbLease:gateway.invalidateFbLease};
  // Each destination gets its own deadline and cleanup path. FC timeouts cannot
  // consume the FB execution window, and FB lease errors cannot discard FC.
  const brokers=Object.fromEntries(['FB','FC'].map(name=>[name,createManagementAuthBroker({enabled:true,
    policy:brokerPolicy,adapters,clock:now,pilotUidAllowlist:pilotAllowlist,pilotDiagnostics:pilotOnly,
    ...(name==='FC'&&fcPilotProvision?{fcPilotProvisionUid:pilotAllowlist[0]}:{})})]));
  const broker={async exchange(body,context={}) {
    const requested=body?.targetProjectIds;
    if(!requested||Object.keys(requested).length<1||Object.keys(requested).length>2
      ||Object.entries(requested).some(([name,id])=>!['FB','FC'].includes(name)||id!==PROJECTS[name])
      ||body.sourceProjectId!==PROJECTS.FA)return {ok:false,code:'BROKER_TARGETS_INVALID'};
    const entries=await Promise.all(Object.keys(requested).map(async name=>{
      if(!enabled[name])return [name,{ok:false,code:'TARGET_DISABLED'}];
      try{return [name,await brokers[name].exchange({...body,targetProjectIds:{[name]:PROJECTS[name]}},context)];}
      catch{return [name,{ok:false,code:'BROKER_OPERATION_FAILED'}];}
    }));
    const ready=entries.filter(([name,result])=>result.ok===true&&result.targets?.[name]?.status==='READY');
    const reconciliation=entries.some(([,result])=>result.requiresReconciliation===true);
    if(!ready.length){
      const diagnostic=pilotOnly?sanitizedManagementPilotDiagnostic(entries[0]?.[1]?.diagnostic):null;
      return {ok:false,code:safeCode(entries[0]?.[1]?.code,'BROKER_EXCHANGE_DENIED'),requiresReconciliation:reconciliation,
        ...(diagnostic?{diagnostic}:{})};
    }
    const uid=ready[0][1].faUid;
    if(context.signal?.aborted||ready.some(([,result])=>result.faUid!==uid))return {ok:false,code:'FA_SESSION_CHANGED',requiresReconciliation:true};
    const targets=Object.fromEntries(entries.map(([name,result])=>{
      const diagnostic=pilotOnly?sanitizedManagementPilotDiagnostic(result.diagnostic):null;
      return [name,result.ok===true?result.targets[name]
        :{projectId:PROJECTS[name],status:'UNAVAILABLE',code:safeCode(result.code,'TARGET_UNAVAILABLE'),
          ...(diagnostic?{diagnostic}:{})}];
    }));
    const fb=entries.find(([name,result])=>name==='FB'&&result.targets?.FB?.status==='READY')?.[1];
    return {...(fb?{destinationProjectId:PROJECTS.FB,fbUid:fb.fbUid,memberId:fb.memberId,leaseVersion:fb.leaseVersion,
      policyVersion:fb.policyVersion,customToken:fb.customToken}:{}),ok:true,sourceProjectId:PROJECTS.FA,faUid:uid,targets,requiresReconciliation:reconciliation};
  }};
  const runtime=createManagementAuthWorkerRuntime({broker,stateBinding:env.BROKER_STATE,now,...MANAGEMENT_RUNTIME_DEFAULTS});
  const firstLoginBroker=firstLoginEnabled?createManagementFaFirstLoginBroker({enabled:true,audience:env.MANAGEMENT_GOOGLE_CLIENT_ID,
    googleVerifier:createGoogleIdTokenVerifier({fetchImpl,clock:now}),gateway,clock:now}):undefined;
  return Object.freeze({...runtime,firstLoginEnabled,pilotOnly,fcPilotProvision,wallClock:now,
    ...(pilotOrigin === undefined ? {} : {allowedOrigin:pilotOrigin}),...(firstLoginEnabled?{firstLoginBroker}:{}),
    dispose(){auth.dispose();gateway.dispose();}});
}
