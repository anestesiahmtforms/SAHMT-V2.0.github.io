/** Reauthorize on demand before expiry. No timer, background polling or FA logout. */
export function createManagementLeaseAccess({now=Date.now,marginMs=30000}={}) {
 let cached=null,pending=null;
 return {async ensure({uid,faAuth,secondaryAuth,readLease,connect}) {
  const faUser=faAuth?.currentUser;
  const assertCurrent=()=>{if(!faUser||faUser.uid!==uid||faAuth.currentUser!==faUser)throw Error('MANAGEMENT_SESSION_CHANGED');};
  assertCurrent();
  const fresh=()=>cached&&cached.faUser===faUser&&cached.secondaryUser===secondaryAuth.currentUser&&cached.uid===uid&&cached.until>now()+marginMs;
  if(fresh())return;
  if(pending?.faUser===faUser){await pending.promise;assertCurrent();if(!fresh())throw Error('MANAGEMENT_LEASE_NOT_CURRENT');return;}
  const task={faUser};
  task.promise=Promise.resolve().then(async()=>{
   let lease=null;
   if(secondaryAuth.currentUser?.uid===uid){
    try{lease=await readLease();}catch(error){if(error?.code!=='permission-denied')throw error;}
   }
   assertCurrent();
   const valid=value=>value&&value.sourceProjectId==='sahmt-17a16'&&value.destinationProjectId==='sahmt-gestao-5ae66'&&
    value.faUid===uid&&value.fbUid===uid&&value.active===true&&value.revoked===false&&value.managementAllowed===true&&
    Number.isSafeInteger(value.confirmedAtMs)&&Number.isSafeInteger(value.validUntilMs)&&
    value.confirmedAtMs<=now()&&value.validUntilMs>now()+marginMs&&value.validUntilMs-value.confirmedAtMs<=300000;
   if(!valid(lease)){
    cached=null;const result=await connect();assertCurrent();
    if(result?.targets?.FB?.status!=='ready'||secondaryAuth.currentUser?.uid!==uid){
     const code=result?.targets?.FB?.code||result?.code;
     throw Error('MANAGEMENT_LEASE_RENEWAL_FAILED'+(typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(code)?': '+code:''));
    }
    lease=await readLease();assertCurrent();
   }
   if(!valid(lease)||secondaryAuth.currentUser?.uid!==uid)throw Error('MANAGEMENT_LEASE_INVALID');
   cached={faUser,secondaryUser:secondaryAuth.currentUser,uid,until:lease.validUntilMs};
  });
  pending=task;
  try{await task.promise;}finally{if(pending===task)pending=null;}
 }};
}
