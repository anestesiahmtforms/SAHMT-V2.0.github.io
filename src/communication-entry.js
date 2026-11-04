import {activeProfile,adminIdentity} from '../communication/domain.js';

export function communicationEntryFromSession(session,{adminMode=false}={}){
 if(session?.status!=='signed-in'||session.offline===true||session.validatingProfile===true||!session.user?.uid||!activeProfile(session.profile))return null;
 const isAdmin=adminIdentity(session.user);
 if(adminMode&&!isAdmin)return null;
 // This opens static navigation only. Every data request remains authorized by the server.
 return {isAdmin};
}
