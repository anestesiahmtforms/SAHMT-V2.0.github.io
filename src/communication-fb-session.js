import {getApps,initializeApp} from 'firebase/app';
import {getAuth,initializeAuth,indexedDBLocalPersistence,browserLocalPersistence,inMemoryPersistence} from 'firebase/auth';
import {GOOGLE_PROJECT_CONFIG} from './google-project-auth-config.js';
import {googleIdentity} from './google-project-auth-core.js';

// FB restores only the existing sessions needed by communication. Account
// linking remains in the main app, using the normal Google sign-in flow.
export async function restoreCommunicationFbSession(target,source,isCurrent){
 if(!['FA','FC','FF'].includes(target)||!isCurrent())return null;
 const {appName,config}=GOOGLE_PROJECT_CONFIG[target];
 const app=getApps().find(existing=>existing.name===appName)||initializeApp(config,appName);
 if(app.options.projectId!==config.projectId||app.options.appId!==config.appId)return null;
 let instance;
 try{instance=initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence,inMemoryPersistence]});}
 catch(error){if(error.code!=='auth/already-initialized')throw error;instance=getAuth(app);}
 await instance.authStateReady();
 const user=instance.currentUser,current=googleIdentity(source),identity=googleIdentity(user);
 if(!isCurrent()||!current?.googleUid||identity?.googleUid!==current.googleUid||
    !source.email||user?.email?.toLowerCase()!==source.email.toLowerCase())return null;
 return instance;
}
