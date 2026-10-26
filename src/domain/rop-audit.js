/** Shared rules for the ROP audit editor. Authentication must be checked by the API. */
export const ROP_AUDIT_STATUSES = Object.freeze(['C', 'NC', 'P', 'NA']);
export const ROP_CASE_STATUSES = Object.freeze(['C', 'NC', 'NO', 'NA']);

export function canManageRopAudit(principal, trainingId) {
  if (!principal || !trainingId) return false;
  if (principal.role === 'admin') return true;
  return principal.role === 'manager'
    && Array.isArray(principal.managedTrainingIds)
    && principal.managedTrainingIds.includes(trainingId);
}

export function summarizeRopCases(cases = []) {
  const counts = { C: 0, NC: 0, NO: 0, NA: 0 };
  for (const item of cases) if (Object.hasOwn(counts, item.result)) counts[item.result]++;
  const denominator = counts.C + counts.NC;
  return { ...counts, denominator, adherence: denominator ? counts.C / denominator * 100 : null };
}

export function concludeRopAudit(schema, answers = {}) {
  const tests = schema.tests || [];
  const statuses = tests.map(t => answers[t.code]?.status);
  if (statuses.includes('NC')) return 'nonconforming';
  if (!tests.length || statuses.some(s => !ROP_AUDIT_STATUSES.includes(s) || s === 'P')) return 'pending';
  if (statuses.every(s => s === 'NA')) return 'not_applicable';
  return 'conforming';
}

const present = value => typeof value === 'string' && value.trim().length > 0;
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validateRopAudit(schema, draft) {
  const errors = [];
  const add = (step, field, message) => errors.push({ step, field, message });
  if (schema.trainingId && draft.trainingId !== schema.trainingId) add(0, 'trainingId', 'A auditoria não corresponde ao treinamento deste modelo.');
  const ctx = draft.context || {};
  for (const [field, label] of [['sector', 'setor'], ['auditor', 'auditor'], ['method', 'método de coleta'], ['population', 'universo e elegibilidade'], ['sampling', 'seleção da amostra']]) {
    if (!present(ctx[field])) add(0, field, `Informe ${label}.`);
  }
  for (const [field, label] of [['date', 'data da auditoria'], ['periodStart', 'início do período'], ['periodEnd', 'fim do período']]) {
    if (!isoDate(ctx[field])) add(0, field, `Informe ${label}.`);
  }
  if (ctx.periodStart > ctx.periodEnd) add(0, 'periodEnd', 'O fim do período deve ser igual ou posterior ao início.');
  for (const test of schema.tests || []) {
    const answer = draft.answers?.[test.code] || {};
    if (!ROP_AUDIT_STATUSES.includes(answer.status)) add(1, test.code, `${test.code}: selecione um resultado.`);
    if (['C', 'NC'].includes(answer.status) && !present(answer.evidence)) add(1, test.code, `${test.code}: identifique a evidência que sustenta o resultado.`);
    if (['NC', 'P'].includes(answer.status) && !present(answer.finding)) add(1, test.code, `${test.code}: descreva o desvio ou a pendência.`);
    if (answer.status === 'NA' && (!present(answer.naReason) || !present(answer.naValidator))) add(1, test.code, `${test.code}: justifique a não aplicabilidade e identifique quem a validou.`);
    if (['NC', 'P'].includes(answer.status)) {
      const linked = (draft.actions || []).filter(a => a.tests?.includes(test.code));
      if (!linked.some(a => present(a.description) && present(a.owner) && isoDate(a.due))) add(4, test.code, `${test.code}: vincule uma ação com descrição, responsável e prazo.`);
    }
  }
  for (const [i, row] of (draft.cases || []).entries()) {
    if (!present(row.reference) || !present(row.criterion) || !ROP_CASE_STATUSES.includes(row.result)) add(2, `case-${i}`, `Coleta ${i + 1}: informe referência anônima, critério e resultado.`);
    if (row.result === 'NA' && !present(row.finding)) add(2, `case-${i}`, `Coleta ${i + 1}: justifique a não elegibilidade.`);
  }
  for (const [i, action] of (draft.actions || []).entries()) {
    const knownCodes = new Set([...(schema.tests || []), ...(schema.checks || [])].map(t => t.code));
    if ((action.tests || []).some(code => !knownCodes.has(code))) add(4, `action-${i}`, `Ação ${i + 1}: há código de teste ou verificação inexistente nesta ROP.`);
    if (!present(action.description) || !present(action.owner) || !isoDate(action.due)) add(4, `action-${i}`, `Ação ${i + 1}: informe descrição, responsável e prazo.`);
    if (action.status === 'closed' && (!present(action.implementation) || !present(action.effectiveness) || !present(action.closedBy) || !isoDate(action.closedAt))) add(4, `action-${i}`, `Ação ${i + 1}: o encerramento exige implementação, eficácia, validador e data.`);
  }
  if (!present(draft.validation?.reviewer)) add(5, 'reviewer', 'Identifique o responsável pela validação da conclusão.');
  return errors;
}

export function finalizeRopAudit(schema, draft, completedAt) {
  const errors = validateRopAudit(schema, draft);
  if (errors.length) return { ok: false, errors };
  const audit = JSON.parse(JSON.stringify(draft));
  audit.status = 'completed';
  audit.completedAt = completedAt;
  audit.conclusion = concludeRopAudit(schema, audit.answers);
  audit.collection = summarizeRopCases(audit.cases);
  audit.schemaVersion = schema.version;
  return { ok: true, audit };
}
