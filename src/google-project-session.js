import {googleIdentity,sameGoogleIdentity} from './google-project-auth-core.js';

/** Wait only for the requested SDK identity; unrelated projects do not gate entry. */
export async function waitForGoogleProjectSession({auth,getSourceUser,controller,target='FB',isCurrent=()=>true,timeoutMs=12000}){
 const expected=googleIdentity(getSourceUser());if(!expected||!auth)return false;
 let timer,unsubscribe,closed=false;
 const sourceCurrent=()=>!closed&&isCurrent()&&sameGoogleIdentity(getSourceUser(),expected)&&!controller.snapshot().signingOut;
 const valid=()=>sourceCurrent()&&sameGoogleIdentity(auth.currentUser,expected);
 const pending=state=>{
  const destination=state.targets?.[target];
  const failed=destination?.status==='pending'&&destination.code;
  // A restore error can still be repaired by the credential already being
  // exchanged. A final connection failure must not wait for other projects.
  return Boolean(state.busy)&&!state.signingOut&&(!failed||state.connecting&&destination.phase!=='connect');
 };
 try{
  const task=(async()=>{
   await auth.authStateReady();if(!sourceCurrent())return false;if(valid())return true;
   if(!pending(controller.snapshot()))return false;
   await new Promise(resolve=>{
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;unsubscribe?.();resolve();};
    unsubscribe=controller.subscribe(state=>{if(valid()||!pending(state)||!sourceCurrent())finish();});
    if(settled)unsubscribe();
   });
   return valid();
  })();
  return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);
 }catch{return false;}finally{closed=true;clearTimeout(timer);unsubscribe?.();}
}
