const TRANSIENT_ERRORS = new Set(['OCCURRENCE_AUTHORIZATION_UNAVAILABLE','OCCURRENCE_CATALOG_READ_UNAVAILABLE','OCCURRENCE_TRANSIENT_WRITE_FAILED']);

function permanentErrorCode(error) {
  if (error?.message === 'OCCURRENCE_PERMISSION_DENIED') return 'permission-denied';
  if (error?.message === 'OCCURRENCE_RECONCILIATION_REQUIRED') return 'reconciliation-required';
  if (error?.message === 'OCCURRENCE_FORM_INVALID') return 'invalid-argument';
  if (error?.message === 'OCCURRENCE_SESSION_INVALID' || error?.message === 'OCCURRENCE_SESSION_CHANGED') return 'session-changed';
  return 'occurrence-save-failed';
}

function safeErrorText(code) {
  if (code === 'permission-denied') return 'A permissão precisa ser conferida antes de tentar novamente.';
  if (code === 'reconciliation-required') return 'O resultado precisa de reconciliação administrativa.';
  if (code === 'invalid-argument') return 'Os dados precisam ser corrigidos antes de novo envio.';
  if (code === 'session-changed') return 'A sessão mudou; entre com a conta original para retomar.';
  return 'O envio local precisa de revisão antes de nova tentativa.';
}

export async function syncOccurrenceOperation({operation,uid,repository,outbox,isCurrent,now=Date.now}={}) {
  if (!uid || operation?.uid !== uid) return 'deferred';
  if (!isCurrent?.()) return 'deferred';
  const validId = /^[A-Fa-f0-9-]{36}$/.test(operation.requestId || '')
    && operation.resourceId === operation.requestId;
  const validPayload = operation.type === 'occurrences' && operation.payload
    && typeof operation.payload === 'object' && !Array.isArray(operation.payload);
  if (!validId || !validPayload) {
    await outbox.updateQueuedOperation(uid,operation.requestId,{status:'failed',attempts:operation.attempts||0,
      lastError:'A operação offline está inconsistente e não foi enviada.',lastErrorCode:'invalid-outbox-operation'});
    return 'needs-review';
  }

  try {
    const result = await repository.save({...operation.payload,uid,recordId:operation.requestId});
    if (!['saved','already-saved'].includes(result?.status) || result.id !== operation.requestId) {
      throw new Error('O servidor retornou confirmação inconsistente.');
    }
    await outbox.removeQueuedOperation(uid,operation.requestId);
    return 'synced';
  } catch (error) {
    if (!isCurrent()) return 'deferred';
    const attempts=(Number.isInteger(operation.attempts)&&operation.attempts>=0?operation.attempts:0)+1;
    const transient=TRANSIENT_ERRORS.has(error?.message);
    const code=transient?'unavailable':permanentErrorCode(error);
    const delay=Math.min(60*60*1000,1000*2**Math.min(attempts,10));
    await outbox.updateQueuedOperation(uid,operation.requestId,{status:transient?'queued':'failed',attempts,
      nextAttemptAt:now()+delay,lastError:transient?'Aguardando o Firestore voltar.':safeErrorText(code),lastErrorCode:code});
    return transient?'queued':'needs-review';
  }
}
