import {staleModuleFailure} from './app-repair.js';
export {waitForGoogleProjectSession as waitForManagementSession} from './google-project-session.js';

export async function ensureManagementSession({isCurrent=()=>true}={}){
 try{
  const runtime=await import('./google-project-auth-runtime.js');
  return await runtime.waitForGoogleProjectSession('FB',{isCurrent});
 }catch(error){if(staleModuleFailure(error))throw error;return false;}
}
