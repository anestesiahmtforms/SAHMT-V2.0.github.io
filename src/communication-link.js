import {adminIdentity,SOURCE_COLLECTIONS,id} from '../communication/domain.js';
export const communicationFeatureEnabled=import.meta.env?.VITE_COMMUNICATION_FF_ENABLED==='true';
export function communicationAdminSession(session){return communicationFeatureEnabled&&session?.status==='signed-in'&&session.profile?.active===true&&session.profile?.access===true&&adminIdentity(session.user);}
export function communicationLink({project='FF',collection,recordId}={}){
 if(!Object.hasOwn(SOURCE_COLLECTIONS,project))throw Error('COMM_SOURCE_UNSUPPORTED');
 if(collection&&!SOURCE_COLLECTIONS[project].includes(collection))throw Error('COMM_SOURCE_UNSUPPORTED');
 return 'https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/#/communications/'+(collection&&recordId?'forward/'+[project,collection,id(recordId)].map(encodeURIComponent).join('/'):'compose/'+project);
}
export function forwardingButton(session,source){if(!communicationAdminSession(session))return '';return `<a class="comm-forward" href="${communicationLink(source)}">ENCAMINHAR PARA PUSH — FF</a>`;}
export function parseCommunicationForward(hash){const parts=hash.split('/');if(parts[2]!=='forward')return null;try{const [project,collection,recordId]=parts.slice(3).map(decodeURIComponent);communicationLink({project,collection,recordId});return {project,collection,id:recordId};}catch{return null;}}
