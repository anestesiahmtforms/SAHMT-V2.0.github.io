import {isSystemOwnerEmail} from '../src/system-account-exclusions.js';

export const FF = Object.freeze({projectId:'sahmt-comunicacao-ff', databaseId:'comunicacao', appName:'sahmt-ff-direct', appId:'1:772883283859:web:9e26ccec85366db0e53266', senderId:'772883283859'});
export const ADMINS = Object.freeze(['wx2064@gmail.com','anestesiahmtforms@gmail.com','anestesiahmtforms6@gmail.com','marcio.henrique82@gmail.com']);
export const CATEGORIES = Object.freeze(['COMUNICADO GERAL','ALERTA OPERACIONAL','INFORMAÇÃO INSTITUCIONAL','GOVERNANÇA','QUALIDADE E SEGURANÇA','ENQUETES E CONSULTAS','AVISO URGENTE']);
export const ROUTES = Object.freeze(['communications','home','management-hub','management','training','events','labels','checklist','occurrences','qmentum']);
export const ROLES = Object.freeze(['coordenador','conselho_diretor','gestor','anestesiologista','residente','temporario','administrador_app']);
export const PAGE_SIZE = 20, BATCH_SIZE = 3;
export const BUILTIN_GROUPS = Object.freeze([{id:'institutional-team',name:'EQUIPE'}, {id:'institutional-resident',name:'RESIDENTES'}, {id:'institutional-substitute',name:'SUBSTITUTOS'}]);
export const SOURCE_COLLECTIONS=Object.freeze({FF:['communicationMessages']});
export const fail = (code,status=400) => Object.assign(new Error(code),{code,status});
export const adminIdentity = user => Boolean(user?.emailVerified===true && ADMINS.includes(String(user.email).trim().toLowerCase()));
export const activeProfile = p => p?.active===true && p?.access===true;
export function id(value){if(typeof value!=='string'||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(value)||['.','..'].includes(value))throw fail('COMM_INVALID_ID');return value;}
export function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('COMM_INVALID_INPUT');return value.trim();}
export function validateMessage(value,now=Date.now()){
 const m={title:text(value.title,120),message:text(value.message,4000),category:value.category,priority:value.priority,audienceType:value.audienceType,audienceValue:value.audienceValue||'',route:value.route,publishAt:Number(value.publishAt),expiresAt:Number(value.expiresAt),status:value.status};
 if(!CATEGORIES.includes(m.category)||!['NORMAL','HIGH','URGENT'].includes(m.priority)||!['ALL','USER','ROLE','GROUP','AREA'].includes(m.audienceType)||!ROUTES.includes(m.route)||!['draft','published'].includes(m.status)||!Number.isSafeInteger(m.publishAt)||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=m.publishAt||m.expiresAt<=now||m.expiresAt-m.publishAt>366*86400000)throw fail('COMM_INVALID_INPUT');
 if(m.audienceType==='ALL')m.audienceValue='';else id(m.audienceValue);
 if(m.audienceType==='ROLE'&&!ROLES.includes(m.audienceValue))throw fail('COMM_INVALID_INPUT');
 const linkUrl=String(value.linkUrl||'').trim();if(linkUrl){let link;try{link=new URL(linkUrl);}catch{throw fail('COMM_INVALID_INPUT');}if(link.protocol!=='https:'||link.username||link.password||linkUrl.length>2048)throw fail('COMM_INVALID_INPUT');m.linkUrl=linkUrl;m.linkLabel=String(value.linkLabel||'ABRIR LINK').trim().slice(0,60)||'ABRIR LINK';}
 return m;
}
export const isCurrentMessage=(m,now=Date.now())=>m?.status==='published'&&m.publishAt<=now&&m.expiresAt>now;
export function matches(message,sourceUid,profile,members){
 if(!activeProfile(profile)||isSystemOwnerEmail(profile.email))return false;
 switch(message.audienceType){case 'ALL':return true;case 'USER':return message.audienceValue===sourceUid;case 'ROLE':return message.audienceValue===profile.role;case 'GROUP':case 'AREA':return members?.includes(sourceUid)===true;default:return false;}
}
export const safePreview=Object.freeze({title:'🔔 SAHMT · NOVO AVISO',body:'Há uma nova comunicação institucional. Abra o SAHMT para consultar.'});
export const automaticNoticePreview=message=>({title:String(message?.title||'SAHMT · NOVO AVISO').slice(0,120),body:[...String(message?.message||'')].slice(0,220).join('')});
