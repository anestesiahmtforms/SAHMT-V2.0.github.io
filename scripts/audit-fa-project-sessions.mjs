import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
const projects={FA:['sahmt-17a16','anestesiahmtforms@gmail.com'],FB:['sahmt-gestao-5ae66','anestesiahmtforms2@gmail.com'],FC:['indicadores---sahmt','anestesiahmtforms3@gmail.com'],FD:['rotinas-8a617','anestesiahmtforms4@gmail.com'],FE:['outros-48120','anestesiahmtforms5@gmail.com'],FF:['sahmt-comunicacao-ff','anestesiahmtforms6@gmail.com'],FG:['sahmt-checklist-fg','sahmtcheck@gmail.com'],FH:['sahmt-etiquetas-fh','etiquetassahmt@gmail.com'],FI:['sahmt-operacional-fi','anestesiahmtforms9@gmail.com'],FJ:['sahmt-escala-fj','anestesiahmtforms10@gmail.com'],FK:['sahmt-funcional-fk','anestesiahmtaula@gmail.com']};
const captures={},report={readOnly:true,projects:{}};
async function read(url,token){const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok){await r.body?.cancel();throw Error('HTTP_'+r.status);}return r.json();}
// Sequential account binding avoids sharing Firebase CLI token caches across owners.
for(const [station,[project,email]]of Object.entries(projects)){
 try{const token=await firebaseCliAccountToken(email).catch(e=>{if(station==='FB')return firebaseCliAccountToken(projects.FA[1]);throw e;}),users=[];let next='';
  do{const data=await read(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000${next?'&nextPageToken='+encodeURIComponent(next):''}`,token);users.push(...(data.users||[]));next=data.nextPageToken||'';}while(next&&users.length<10000);
  captures[station]=users;
  report.projects[station]={accounts:users.length,disabled:users.filter(u=>u.disabled).length};
  const config=await read(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`,token);
  report.projects[station]={accounts:users.length,disabled:users.filter(u=>u.disabled).length,signupDisabled:config.client?.permissions?.disabledUserSignup===true,appDomainAuthorized:config.authorizedDomains?.includes('anestesiahmtforms.github.io')===true};
 }catch(e){report.projects[station]={...report.projects[station],unavailable:/^(HTTP_\d+|CLI_ACCOUNT_[A-Z_]+)$/.test(e.message)?e.message:'READ_UNAVAILABLE'};}
}
const google=u=>u.providerUserInfo?.find(p=>p.providerId==='google.com')?.rawId;
if(captures.FA)for(const [station,users]of Object.entries(captures)){
 if(station==='FA')continue;
 const bySubject=new Map(users.filter(google).map(u=>[google(u),u]));
 const matched=captures.FA.filter(google).map(u=>[u,bySubject.get(google(u))]);
 const byUid=new Map(users.map(u=>[u.localId,u]));
 Object.assign(report.projects[station],{sourceUidPresent:captures.FA.filter(u=>byUid.has(u.localId)).length,uidEmailMismatch:captures.FA.filter(u=>byUid.has(u.localId)&&u.email?.toLowerCase()!==byUid.get(u.localId).email?.toLowerCase()).length,googleMatched:matched.filter(([,d])=>d).length,googleMissing:matched.filter(([,d])=>!d).length,uidMismatch:matched.filter(([s,d])=>d&&s.localId!==d.localId).length});
}
report.sourceAccountsWithoutGoogle=captures.FA?.filter(u=>!google(u)).length;
console.log(JSON.stringify(report,null,2));
