const error=code=>Object.assign(new Error(code),{code});
export function googleTokenClaims(credential,decode=value=>atob(value)) {
  if(credential?.providerId!=='google.com'||typeof credential.idToken!=='string')throw error('AUTH_CREDENTIAL_REQUIRED');
  try{const parts=credential.idToken.split('.');if(parts.length!==3)throw Error();
    const part=parts[1].replaceAll('-','+').replaceAll('_','/');
    const claims=JSON.parse(decode(part.padEnd(Math.ceil(part.length/4)*4,'=')));
    if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||typeof claims.sub!=='string'||!claims.sub||typeof claims.aud!=='string'||!claims.aud)throw Error();
    return claims;
  }catch{throw error('AUTH_GOOGLE_IDENTITY_MISMATCH');}
}

/** Google's server verifies the credential. Decoding above only rejects wrong inputs early. */
export async function verifyExistingGoogleDestination({entry,credential,expected,requestUri,fetchImpl=fetch,isCurrent=()=>true}={}) {
  const claims=googleTokenClaims(credential);
  if(claims.sub!==expected?.googleUid)throw error('AUTH_GOOGLE_IDENTITY_MISMATCH');
  if(!entry?.googleEnabled||!entry?.config?.apiKey)throw error('AUTH_CONFIGURATION_REQUIRED');
  if(entry.clientSignupDisabled!==true)throw error('AUTH_SIGNUP_GUARD_REQUIRED');
  if(!entry.acceptedGoogleClientIds?.includes(claims.aud))throw error('AUTH_AUDIENCE_NOT_VERIFIED');
  if(!isCurrent())throw error('AUTH_ACCOUNT_CHANGED');
  const api='https://identitytoolkit.googleapis.com/v1/accounts:';
  async function post(method,body){let response;
    try{response=await fetchImpl(api+method+'?key='+encodeURIComponent(entry.config.apiKey),{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',
      redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw error('auth/network-request-failed');}
    const value=await response.json().catch(()=>({}));
    if(!response.ok){const raw=String(value.error?.message||'').split(' : ')[0];
      const codes={USER_NOT_FOUND:'AUTH_EXISTING_ACCOUNT_REQUIRED',EMAIL_EXISTS:'AUTH_EXISTING_ACCOUNT_REQUIRED',
        USER_DISABLED:'auth/user-disabled',OPERATION_NOT_ALLOWED:'auth/operation-not-allowed',INVALID_IDP_RESPONSE:'auth/invalid-credential',
        INVALID_ID_TOKEN:'auth/invalid-credential',FEDERATED_USER_ID_ALREADY_LINKED:'AUTH_GOOGLE_IDENTITY_MISMATCH'};
      throw error(codes[raw]||(response.status>=500?'auth/network-request-failed':'AUTH_UNAVAILABLE'));
    }return value;
  }
  // This legacy option is also used by SDK reauthentication. Real-project proof is required
  // before activation. Never retry without it, link by email or import a chosen UID here.
  const result=await post('signInWithIdp',{requestUri,returnSecureToken:true,returnIdpCredential:false,autoCreate:false,
    postBody:new URLSearchParams({providerId:'google.com',id_token:credential.idToken}).toString()});
  if(!isCurrent())throw error('AUTH_ACCOUNT_CHANGED');
  if(result.isNewUser===true||result.needConfirmation||result.mfaPendingCredential||!result.idToken)throw error('AUTH_EXISTING_ACCOUNT_REQUIRED');
  if(result.localId!==expected.uid)throw error('AUTH_UID_MISMATCH');
  const lookup=await post('lookup',{idToken:result.idToken});
  const account=lookup.users?.length===1?lookup.users[0]:null;
  if(account?.localId!==expected.uid)throw error('AUTH_UID_MISMATCH');
  if(account.disabled)throw error('auth/user-disabled');
  if(!account.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===expected.googleUid))throw error('AUTH_GOOGLE_IDENTITY_MISMATCH');
  if(!isCurrent())throw error('AUTH_ACCOUNT_CHANGED');
  // Issued tokens stay inside this call and are never persisted by application code.
  return {uid:account.localId,googleUid:expected.googleUid};
}
