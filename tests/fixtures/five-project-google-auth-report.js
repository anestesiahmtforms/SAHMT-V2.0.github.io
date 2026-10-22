import {googleIdentity,safeGoogleAuthCode} from '../../src/google-project-auth-core.js';
const projects=['FA','FB','FC','FD','FE'];
const observedCodes=new Set(['AUTH_PROOF_CONNECTED','AUTH_PROOF_PARTIAL','AUTH_RESTORE_OBSERVED','AUTH_PILOT_ACCOUNT_REQUIRED']);
const code=value=>value?(observedCodes.has(value)?value:safeGoogleAuthCode({code:value})):null;
export function authProofReport({state,users={},evidence={},expectedUid,now=()=>new Date().toISOString()}){
  const source=googleIdentity(users.FA);
  const permitted=Boolean(source&&source.uid===expectedUid);
  return {schemaVersion:1,code:'FIVE_PROJECT_AUTH_PROOF',observedAt:now(),pilotIdentityMatches:permitted,
    firestoreReads:0,firestoreWrites:0,
    googleConfirmations:Number.isSafeInteger(evidence.confirmations)?Math.max(0,evidence.confirmations):0,
    reauthenticated:evidence.reauthenticated===true,resultCode:code(evidence.code),
    logout:evidence.logout?['complete','partial','superseded'].includes(evidence.logout.status)?evidence.logout.status:'unavailable':null,
    projects:Object.fromEntries(projects.map(target=>{
      const identity=googleIdentity(users[target]),exchange=evidence.exchanges?.[target];
      return [target,{status:identity?'connected':'disconnected',uidMatchesFa:permitted&&identity?identity.uid===source.uid:null,
        googleIdentityMatchesFa:permitted&&identity?identity.googleUid===source.googleUid:null,
        exchange:target==='FA'?null:['passed','attempted','failed'].includes(exchange?.status)?exchange.status:'not_attempted',
        code:code(exchange?.code||state?.targets?.[target]?.code)}];
    }))};
}
