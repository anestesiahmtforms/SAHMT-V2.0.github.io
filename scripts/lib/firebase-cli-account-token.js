import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function freshCliAuth(){
 const path=require.resolve('firebase-tools/lib/auth');
 // CLI 15.31 keeps a process-global lastAccessToken and does not compare its
 // refresh token on every cache hit. Never share that cache across principals.
 delete require.cache[path];return require(path);
}
export async function firebaseCliAccountToken(email,{loadAuth=freshCliAuth,fetchImpl=fetch}={}){
 const auth=loadAuth(),account=auth.getAllAccounts().find(item=>item.user?.email===email);
 if(!account?.tokens?.refresh_token)throw Error('CLI_ACCOUNT_LOGIN_REQUIRED');
 let token;try{token=await auth.getAccessToken(account.tokens.refresh_token,
  ['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/userinfo.email']);}
 catch{throw Error('CLI_ACCOUNT_SESSION_EXPIRED');}
 if(!token?.access_token||token.access_token===account.tokens.refresh_token||token.refresh_token!==account.tokens.refresh_token
  ||!Number.isFinite(token.expires_at)||token.expires_at<=Date.now())throw Error('CLI_ACCOUNT_TOKEN_BINDING_INVALID');
 let response,identity;try{
  response=await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo',{method:'GET',headers:{Authorization:'Bearer '+token.access_token},
   redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error();identity=await response.json();
 }catch{throw Error('CLI_ACCOUNT_IDENTITY_UNAVAILABLE');}
 if(identity?.email!==email||identity.verified_email!==true)throw Error('CLI_ACCOUNT_IDENTITY_MISMATCH');
 return token.access_token;
}
