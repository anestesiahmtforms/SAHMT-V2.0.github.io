export const HISTORY_FOLDER='1oRqrwBKs6I6YHyGLxMj8j0_MI8dcuI3X';
export const HISTORY_HEADERS=Object.freeze({
 Mensagens:['ID','Enviado em (UTC)','Remetente','Título','Mensagem completa','Tipo de público','Público selecionado','Destinatários registrados','Primeira linha dos destinatários','Quantidade de destinatários','Tipo de atividade','Atividade','Versão ou ciclo','Nota mínima','Nota máxima','Situação','Atualizado em (UTC)'],
 Destinatarios:['Mensagem ID','Integrante UID','Nome no envio','E-mail no envio','Grupo no envio','Primeira leitura (UTC)','Conclusão (UTC)','Situação','Nota confirmada','Nota mínima','Versão ou ciclo'],
 Eventos:['Evento ID','Mensagem ID','Integrante UID','Tipo','Data e hora (UTC)','Detalhes'],
 Controle:['Chave','Valor']
});
const stamp=v=>Number.isSafeInteger(v)&&v>0
 ? new Date(v).toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(.+)Z$/, '$3/$2/$1 $4 UTC')
 : '';
const instant=v=>{
 if(typeof v!=='string'||!v)return null;
 const match=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2}\.\d{3}) UTC$/.exec(v);
 const iso=match?`${match[3]}-${match[2]}-${match[1]}T${match[4]}Z`:v;
 const time=Date.parse(iso);
 return Number.isFinite(time)&&(!match||new Date(time).toISOString()===iso)?time:null;
};
const numeric=v=>v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
export function historyMessageRow(message,binding={}){
 const recorded=Number.isSafeInteger(binding.recipientStart)&&binding.recipientStart>=2&&Number.isSafeInteger(binding.recipientCount)&&binding.recipientCount>=0;
 const a=message.activity;
 return [message.id,stamp(message.publishAt),message.createdBy?.email||'',message.title||'',message.message||'',message.audienceType||'',message.audienceValue||'',recorded?'SIM':'NÃO REGISTRADO NO ENVIO ORIGINAL',recorded?binding.recipientStart:'',recorded?binding.recipientCount:'',a?.kind||'',a?.id||'',a?.version??a?.cycle??'',a?.minimumScore??'',a?.maxScore??'',message.status||'published',stamp(message.updatedAt||message.publishAt)];
}
export function parseHistoryMessage(r){
 const kind=r[10],activity=kind?{kind,id:r[11],title:r[3],...(kind==='TRAINING'?{version:numeric(r[12]),minimumScore:numeric(r[13]),maxScore:numeric(r[14])}:{cycle:String(r[12])})}:null;
 return {id:r[0],publishAt:instant(r[1]),senderEmail:r[2]||'',title:r[3]||'',message:r[4]||'',audienceType:r[5]||'',audienceValue:r[6]||'',recipientsRecorded:r[7]==='SIM',recipientStart:numeric(r[8]),recipientCount:r[7]==='SIM'?numeric(r[9]):null,activity,status:r[15]||'published',updatedAt:instant(r[16])};
}
export function historyRecipientRow(message,recipient){
 return [message.id,recipient.uid,recipient.displayName||'',recipient.email||'',recipient.institutionalGroup||'',stamp(recipient.readAt),stamp(recipient.completedAt),recipient.status||'',recipient.score??'',message.activity?.minimumScore??'',message.activity?.version??message.activity?.cycle??''];
}
export function parseHistoryRecipient(r){return {messageId:r[0],uid:r[1],displayName:r[2]||'',email:r[3]||'',institutionalGroup:r[4]||'',readAt:instant(r[5]),completedAt:instant(r[6]),status:r[7]||'',score:numeric(r[8]),minimumScore:numeric(r[9]),versionOrCycle:r[10]??''};}
export function historyEventRow(event){return [event.id,event.messageId||'',event.uid||'',event.type,stamp(event.at),JSON.stringify(event.detail||{})];}
