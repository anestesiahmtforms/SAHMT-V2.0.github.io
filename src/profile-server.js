import {auth} from './firebase-auth.js';
import {appCheckReady} from './firebase-app.js';
import {deployment} from './deployment-context.js';
import {createProfileServerReader} from './profile-server-reader.js';

export const readOwnProfileDocument=createProfileServerReader({
  projectId:deployment.projectId,getCurrentUser:()=>auth?.currentUser,
  getAppCheckToken:async()=>{
    const appCheck=await appCheckReady;
    if(!appCheck)return null;
    const {getToken}=await import('firebase/app-check');
    const result=await getToken(appCheck);
    if(!result?.token)throw Object.assign(new Error('Atestado de acesso indisponível.'),{code:'unavailable'});
    return result.token;
  }
});
