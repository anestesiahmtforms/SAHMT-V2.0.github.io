import {adminIdentity,fail,id,text} from './domain.js';

export const operationalNoticeIdentity=user=>adminIdentity(user)&&String(user.email).trim().toLowerCase()==='marcio.henrique82@gmail.com';
export const RELEASE_NOTICE=Object.freeze({title:'LIBERAÇÃO',message:'Você está Liberado! O SAHMT agradece por sua dedicação. BOM DESCANSO! 🤜🤛.'});

export function newUrgentNoticeId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return 'urgent-'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function urgentNoticeInput({noticeId,title,message},now=Date.now()){
 const key=id(noticeId);
 if(!key.startsWith('urgent-'))throw fail('COMM_INVALID_ID');
 return {id:key,version:0,message:{title:text(title,120),message:text(message,4000),category:'AVISO URGENTE',priority:'URGENT',audienceType:'ALL',audienceValue:'',route:'home',publishAt:now,expiresAt:now+7*86400000,status:'published'}};
}
