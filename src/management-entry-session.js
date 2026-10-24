import {googleIdentity,sameGoogleIdentity} from './google-project-auth-core.js';
import {staleModuleFailure} from './app-repair.js';

export async function waitForManagementSession({auth,getSourceUser,controller,timeoutMs=12000}){
 const expected=googleIdentity(getSourceUser());if(!expected||!auth)return false;
 let timer,unsubscribe,closed=false;
 const valid=()=>sameGoogleIdentity(getSourceUser(),expected)&&sameGoogleIdentity(auth.currentUser,expected);
 try{
  const task=(async()=>{
   await auth.authStateReady();if(closed)return false;if(valid())return true;
   if(!sameGoogleIdentity(getSourceUser(),expected)||!controller.snapshot().busy)return false;
   await new Promise(resolve=>{
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;unsubscribe?.();resolve();};
    unsubscribe=controller.subscribe(state=>{if(valid()||!state.busy||!sameGoogleIdentity(getSourceUser(),expected))finish();});
    if(settled)unsubscribe();
   });
   return valid();
  })();
  return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);
 }catch{return false;}finally{closed=true;clearTimeout(timer);unsubscribe?.();}
}

export async function ensureManagementSession(){
 try{
  const [{auth},runtime]=await Promise.all([import('./firebase-auth.js'),import('./google-project-auth-runtime.js')]);
  return await waitForManagementSession({auth:runtime.getGoogleProjectAuth('FB'),getSourceUser:()=>auth?.currentUser,controller:runtime.googleProjectAuth});
 }catch(error){if(staleModuleFailure(error))throw error;return false;}
}
