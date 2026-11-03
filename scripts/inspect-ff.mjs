// Read-only inventory. Tokens remain in memory; output only release checks.
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {ADMINS,FF} from '../communication/domain.js';
const api=async(token,url,body)=>{
 const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok){await r.body?.cancel();throw Error('INSPECTION_HTTP_'+r.status);}return r.json();
};
try{
 const ff=await firebaseCliAccountToken('anestesiahmtforms6@gmail.com'),fa=await firebaseCliAccountToken('anestesiahmtforms@gmail.com');
 const billing=await api(ff,`https://cloudbilling.googleapis.com/v1/projects/${FF.projectId}/billingInfo`);
 const {databases}=await api(ff,`https://firestore.googleapis.com/v1/projects/${FF.projectId}/databases`);
 const source=await api(fa,'https://identitytoolkit.googleapis.com/v1/projects/sahmt-17a16/accounts:lookup',{email:ADMINS});
 const target=await api(ff,`https://identitytoolkit.googleapis.com/v1/projects/${FF.projectId}/accounts:lookup`,{email:ADMINS});
 const administrators=[];
 for(const email of ADMINS){
  const a=source.users?.find(x=>x.email===email),b=target.users?.find(x=>x.email===email);
  const profile=a?await api(fa,`https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/users/${a.localId}`):null;
  const google=a?.providerUserInfo?.find(x=>x.providerId==='google.com')?.rawId;
  administrators.push({email,verifiedGoogleIdentity:!!google&&!!a.emailVerified&&!!b?.emailVerified&&!a.disabled&&!b?.disabled&&b?.providerUserInfo?.some(x=>x.providerId==='google.com'&&x.rawId===google),activeProfile:profile?.fields?.active?.booleanValue===true&&profile?.fields?.access?.booleanValue===true});
 }
 const free=billing.billingEnabled===false&&!billing.billingAccountName&&databases?.length===1&&databases[0].name===`projects/${FF.projectId}/databases/${FF.databaseId}`&&databases[0].freeTier===true;
 console.log(JSON.stringify({project:FF.projectId,database:FF.databaseId,billingEnabled:billing.billingEnabled,billingAccountLinked:!!billing.billingAccountName,freeTier:databases?.[0]?.freeTier,onlyExpectedDatabase:databases?.length===1&&databases[0].name.endsWith('/'+FF.databaseId),administrators,verified:free&&administrators.every(a=>a.verifiedGoogleIdentity&&a.activeProfile)}));
 if(!free||administrators.some(a=>!a.verifiedGoogleIdentity||!a.activeProfile))process.exitCode=1;
}catch(e){console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'INSPECTION_FAILED');process.exitCode=1;}
