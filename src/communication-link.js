import {adminIdentity} from '../communication/domain.js';
export const communicationFeatureEnabled=import.meta.env?.VITE_COMMUNICATION_FF_ENABLED==='true';
const communicationDeviceStateKey='sahmt-communication-ff-device-state';
export function communicationDevicePushActive(){
 if(typeof Notification==='undefined'||Notification.permission!=='granted')return false;
 try{return localStorage.getItem(communicationDeviceStateKey)!=='disabled';}catch{return true;}
}
export function rememberCommunicationDevicePushActive(active){
 try{localStorage.setItem(communicationDeviceStateKey,active?'active':'disabled');}catch{}
}
export function communicationAdminSession(session){return communicationFeatureEnabled&&session?.status==='signed-in'&&session.profile?.active===true&&session.profile?.access===true&&adminIdentity(session.user);}
