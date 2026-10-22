const projects=['FA','FB','FC','FD','FE'];

/** No remote calls. Enabling a release requires recorded real credential proof. */
export function assertGoogleProjectAuthRelease({enabled,entries,target='FA',legacyEnabled=false}) {
  if(enabled!=='true')return {enabled:false};
  if(legacyEnabled)throw new Error('GOOGLE_AUTH_LEGACY_FLOW_CONFLICT');
  if(target!=='FA')throw new Error('GOOGLE_AUTH_ENTRY_MUST_BE_FA');
  const sourceClients=entries?.FA?.acceptedGoogleClientIds||[];
  if(!sourceClients.length)throw new Error('GOOGLE_AUTH_SOURCE_CLIENT_MISSING');
  for(const target of projects){
    const entry=entries?.[target];
    if(!entry?.config?.appId||!entry.config.projectId||!entry.googleEnabled)
      throw new Error(`GOOGLE_AUTH_CONFIGURATION_REQUIRED_${target}`);
    if(target!=='FA'&&entry.clientSignupDisabled!==true)
      throw new Error(`GOOGLE_AUTH_SIGNUP_GUARD_REQUIRED_${target}`);
    if(!sourceClients.some(client=>entry.acceptedGoogleClientIds?.includes(client)))
      throw new Error(`GOOGLE_AUTH_AUDIENCE_UNVERIFIED_${target}`);
    if(entry.credentialExchangeVerified!==true)
      throw new Error(`GOOGLE_AUTH_REAL_PROOF_REQUIRED_${target}`);
  }
  if(entries.FA.googleButtonOriginVerified!==true)throw new Error('GOOGLE_AUTH_BUTTON_ORIGIN_UNVERIFIED');
  if(entries.FA.sessionPersistenceVerified!==true)throw new Error('GOOGLE_AUTH_PERSISTENCE_PROOF_REQUIRED');
  if(entries.FA.globalSignOutVerified!==true)throw new Error('GOOGLE_AUTH_LOGOUT_PROOF_REQUIRED');
  return {enabled:true};
}
