import {createFiAdminAdapter} from './fi-admin-adapter.js';
import {fiControlRequest} from './fi-control-client.js';
export const fiAdminEnabled=()=>import.meta.env?.VITE_FI_ADMIN_ENABLED==='true';
const adapter=createFiAdminAdapter({request:fiControlRequest,getActorUid:async()=>{const {auth}=await import('./firebase-auth.js');return auth?.currentUser?.uid;}});
async function invoke(name,args,legacy='./data.js'){
 if(fiAdminEnabled())return adapter[name](...args);
 const module=legacy==='./data-lite.js'?await import('./data-lite.js'):legacy==='./app-updates-targeted-firebase.js'?await import('./app-updates-targeted-firebase.js'):await import('./data.js');
 return module[name](...args);
}
export const listContactCatalog=(...args)=>invoke('listContactCatalog',args);
export const saveContact=(...args)=>invoke('saveContact',args);
export const updateContactRegistrationFields=(...args)=>invoke('updateContactRegistrationFields',args);
export const syncEventMemberDirectory=(...args)=>invoke('syncEventMemberDirectory',args);
export const listUserProfiles=(...args)=>invoke('listUserProfiles',args);
export const listAccessRequests=(...args)=>invoke('listAccessRequests',args);
export const listMemberCategoryAssignments=(...args)=>invoke('listMemberCategoryAssignments',args);
export const saveUserProfile=(...args)=>invoke('saveUserProfile',args);
export const setFirstLoginCohort=(...args)=>invoke('setFirstLoginCohort',args);
export const readAppFeatures=(...args)=>invoke('readAppFeatures',args,'./data-lite.js');
export const saveAppFeatures=(...args)=>invoke('saveAppFeatures',args);
export const listLabelModuleProfiles=async(...args)=>(await import('./data.js')).listLabelModuleProfiles(...args);
export const readUserAppUpdates=(...args)=>invoke('readUserAppUpdates',args,'./app-updates-targeted-firebase.js');
export const requestUserAppUpdate=(...args)=>invoke('requestUserAppUpdate',args,'./app-updates-targeted-firebase.js');
export const cancelUserAppUpdate=(...args)=>invoke('cancelUserAppUpdate',args,'./app-updates-targeted-firebase.js');
export const listAppUpdateUsers=(...args)=>invoke('listAppUpdateUsers',args,'./app-updates-targeted-firebase.js');
export const sendAppUpdateBatch=(...args)=>invoke('sendAppUpdateBatch',args,'./app-updates-targeted-firebase.js');
export {watchAppInstallations} from './app-updates-targeted-firebase.js';
