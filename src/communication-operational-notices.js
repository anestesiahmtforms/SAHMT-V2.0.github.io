import {activeProfile,adminIdentity,fail,id,text} from '../communication/domain.js';
import {communicationLimitMessage} from './communication-usage.js';

export const operationalNoticeIdentity=user=>adminIdentity(user)&&String(user.email).trim().toLowerCase()==='marcio.henrique82@gmail.com';
export const RELEASE_NOTICE=Object.freeze({title:'LIBERAÇÃO',message:'Você está Liberado! O SAHMT agradece por sua dedicação. BOM DESCANSO! 🤜🤛.'});

export const scheduleReleaseIdentity=(profile,user)=>activeProfile(profile)&&user?.emailVerified===true&&(profile.role==='administrador_app'||profile.permissions?.admin===true||operationalNoticeIdentity(user));

export function releaseNoticeFeedback(result,sigla=''){
 const label=sigla?` para ${sigla}`:'',published=result.alreadySent?`O aviso desta liberação${label} já está publicado.`:`Aviso de liberação${label} publicado.`;
 if(result.pushEnabled===false)return `${published} O Push está desativado na Central.`;
 if(result.dispatch?.accepted>0)return `${published} Push aceito pelo serviço de notificações.`;
 if(result.pushEligible===false||result.dispatch?.status==='completed'&&result.dispatch.processed===0)return `${published} Nenhum aparelho com Push ativo foi encontrado para esta pessoa.`;
 if(result.dispatch?.status==='completed'&&(result.dispatch.failed>0||result.dispatch.skipped>0||result.dispatch.unknown>0))return `${published} O Push não foi confirmado. Confira o histórico de envios e o aparelho do destinatário.`;
 if(result.pushQueued)return `${published} Push na fila de processamento; recebimento ainda não confirmado.`;
 return `${published} O serviço não confirmou a entrada do Push na fila.`;
}

export function releaseNoticeError(error){
 const limit=communicationLimitMessage(error);if(limit)return 'A liberação foi salva, mas o aviso não foi confirmado. '+limit;
 const reason={COMM_SESSION_INVALID:'Conecte sua conta à Central de Comunicação e tente concluir o aviso.',COMM_IDENTITY_MISMATCH:'Confirme na Central a mesma conta Google usada no aplicativo.',COMM_INVALID_AUDIENCE:'A sigla precisa estar vinculada a um único usuário ativo no cadastro.',COMM_FORBIDDEN:'Confira a autorização para liberar a escala.',COMM_FREE_QUOTA_EXHAUSTED:'O limite gratuito da Central foi atingido.',COMM_RATE_LIMIT:'O limite de ações por minuto foi atingido. Aguarde antes de tentar novamente.'}[error?.code]||'Abra a Central de Comunicação para conferir o envio antes de tentar novamente.';
 return 'A liberação foi salva, mas o aviso não foi confirmado. '+reason;
}

export function newUrgentNoticeId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return 'urgent-'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function urgentNoticeInput({noticeId,title,message},now=Date.now()){
 const key=id(noticeId);
 if(!key.startsWith('urgent-'))throw fail('COMM_INVALID_ID');
 return {id:key,version:0,message:{title:text(title,120),message:text(message,4000),category:'AVISO URGENTE',priority:'URGENT',audienceType:'ALL',audienceValue:'',route:'home',publishAt:now,expiresAt:now+7*86400000,status:'published'}};
}
