const endpoint='https://sahmt-ff-comunicacao.anestesiahmtforms6.workers.dev/v1/communication';
const origin='https://anestesiahmtforms.github.io';

export async function verifyRegistrationInvitation(invitation,{survey,cycle,email},fetchImpl=fetch) {
 if(!invitation||Object.keys(invitation).length!==2||
    typeof invitation.id!=='string'||!/^activity-[a-zA-Z0-9-]{1,100}$/.test(invitation.id)||
    typeof invitation.token!=='string'||!/^[A-Za-z0-9_.-]{50,15000}$/.test(invitation.token))return false;
 const response=await fetchImpl(endpoint,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
  headers:{Origin:origin,Authorization:'Bearer '+invitation.token,'Content-Type':'application/json'},
  body:JSON.stringify({action:'REGISTRATION_INVITATION',input:{id:invitation.id,survey,cycle,email:email.trim().toLowerCase()}})
 });
 if(!response.ok){
  await response.body?.cancel();
  if([401,403,404].includes(response.status))return false;
  throw Error('REGISTRATION_INVITATION_UNAVAILABLE');
 }
 return (await response.json())?.authorized===true;
}
