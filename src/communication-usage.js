export const COMMUNICATION_LIMITS=Object.freeze({dailyOperations:2000,dailyPublications:200,minuteOperations:20,externalCalls:44});

export function communicationUsagePeriod(now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10),startsAt=Date.parse(day+'T00:00:00Z');
 return {day,startsAt,resetsAt:startsAt+86400000};
}

export function communicationLimitMessage(error){
 const messages={COMM_DAILY_OPERATION_LIMIT:'A proteção diária de operações da Central foi atingida.',COMM_DAILY_PUBLICATION_LIMIT:'O limite diário de novos avisos publicados foi atingido.',COMM_OPERATION_WORK_LIMIT:'Esta operação excedeu o limite interno de trabalho. Confira o histórico antes de repetir um envio.',COMM_PROVIDER_QUOTA_EXHAUSTED:'O provedor limitou as operações. A Central não ativa plano pago automaticamente.'};
 const base=messages[error?.code];if(!base)return '';
 const usage=Number.isSafeInteger(error.used)&&Number.isSafeInteger(error.limit)?` Uso: ${error.used}/${error.limit}.`:'';
 const reset=Number.isSafeInteger(error.resetsAt)?' Renova em '+new Date(error.resetsAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).':'';
 return base+usage+reset;
}
