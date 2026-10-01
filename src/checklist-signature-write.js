export async function stageChecklistSignatureRequest(transaction, reference, request, {assertCurrent, requestedAt} = {}) {
  assertCurrent?.();
  const existing = await transaction.get(reference);
  assertCurrent?.();
  if (existing.exists()) {
    const saved = existing.data();
    if (saved.signerUid !== request.signerUid || saved.day !== request.day || saved.revision !== request.revision) {
      throw new Error('O pedido de assinatura existente não corresponde a esta sessão.');
    }
    return {id: request.id, status: saved.status, alreadyRequested: true};
  }
  transaction.set(reference, {...request, status: 'PENDING_VALIDATION', requestedAt: requestedAt()});
  return {id: request.id, status: 'PENDING_VALIDATION', alreadyRequested: false};
}
