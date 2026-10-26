import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageRopAudit, summarizeRopCases, concludeRopAudit, validateRopAudit, finalizeRopAudit } from '../src/domain/rop-audit.js';

const schema = { version: '1', tests: [{ code: 'T1' }, { code: 'T2' }], checks: [{ code: 'V1', text: 'Foi identificada expressão proibida?' }] };
const draft = () => ({ context: { sector: 'SRPA', auditor: 'Auditor', date: '2026-10-25', periodStart: '2026-10-01', periodEnd: '2026-10-25', method: 'Revisão documental', population: 'Transições elegíveis', sampling: 'Amostra justificada' }, answers: { T1: { status: 'C', evidence: 'E001' }, T2: { status: 'C', evidence: 'E002' } }, checks: { V1: { finding: 'Ocorrência identificada, registrada separadamente.' } }, cases: [], actions: [], validation: { reviewer: 'Validador' } });

test('audit access is denied to participants and managers of another training', () => {
 assert.equal(canManageRopAudit(null, 'rop-01'), false);
 assert.equal(canManageRopAudit({ role: 'participant' }, 'rop-01'), false);
 assert.equal(canManageRopAudit({ role: 'manager', managedTrainingIds: ['rop-02'] }, 'rop-01'), false);
 assert.equal(canManageRopAudit({ role: 'manager', managedTrainingIds: ['rop-01'] }, 'rop-01'), true);
 assert.equal(canManageRopAudit({ role: 'admin' }, 'rop-01'), true);
});
test('case rates exclude nonobserved and ineligible cases and do not invent a zero-denominator rate', () => {
 assert.equal(summarizeRopCases([{ result: 'NO' }, { result: 'NA' }]).adherence, null);
 const stats = summarizeRopCases([{ result: 'C' }, { result: 'NC' }, { result: 'NO' }, { result: 'NA' }, {}]);
 assert.equal(stats.denominator, 2); assert.equal(stats.adherence, 50);
});
test('complementary and negatively worded checks do not change the ROP conclusion', () => {
 const d = draft(); assert.equal(concludeRopAudit(schema, d.answers), 'conforming');
 d.answers.T2.status = 'P'; assert.equal(concludeRopAudit(schema, d.answers), 'pending');
 d.answers.T1.status = 'NC'; assert.equal(concludeRopAudit(schema, d.answers), 'nonconforming');
 assert.equal(concludeRopAudit({ tests: [] }, {}), 'pending');
});
test('nonapplicability requires its own justification and validator', () => {
 const d = draft(); d.answers.T2 = { status: 'NA' };
 assert.ok(validateRopAudit(schema, d).some(e => e.field === 'T2'));
 d.answers.T2.naReason = 'População não atendida'; d.answers.T2.naValidator = 'Responsável';
 assert.equal(validateRopAudit(schema, d).length, 0);
});
test('a deviation needs evidence and a linked corrective action, and closure needs effectiveness', () => {
 const d = draft(); d.answers.T1 = { status: 'NC', finding: 'Desvio' };
 let errors = validateRopAudit(schema, d); assert.ok(errors.some(e => e.step === 1)); assert.ok(errors.some(e => e.step === 4));
 d.answers.T1.evidence = 'E001'; d.actions.push({ tests: ['T1'], description: 'Corrigir fluxo', owner: 'Responsável', due: '2026-11-01', status: 'open' });
 assert.equal(validateRopAudit(schema, d).length, 0);
 d.actions[0].status = 'closed'; assert.ok(validateRopAudit(schema, d).some(e => /eficácia/.test(e.message)));
});
test('completion validates before taking an independent snapshot and assigns no training points', () => {
 const d = draft(); const res = finalizeRopAudit(schema, d, '2026-10-25T20:00:00Z');
 assert.equal(res.ok, true); d.answers.T1.status = 'NC';
 assert.equal(res.audit.answers.T1.status, 'C'); assert.equal(res.audit.conclusion, 'conforming');
 assert.equal('score' in res.audit, false);
 const invalid = draft(); invalid.answers.T1.evidence = ''; assert.equal(finalizeRopAudit(schema, invalid, '').ok, false);
});
test('an audit cannot be completed against another training model', () => {
 const d = draft(); d.trainingId = 'rop-training-22';
 const bound = { ...schema, trainingId: 'rop-training-01' };
 const res = finalizeRopAudit(bound, d, '2026-10-25T20:00:00Z');
 assert.equal(res.ok, false);
 assert.ok(res.errors.some(e => e.field === 'trainingId'));
});
test('invalid calendar dates and nonexistent action codes are rejected', () => {
 const d = draft(); d.context.date = '2026-02-31';
 d.actions.push({ tests: ['T999'], description: 'Ação', owner: 'Responsável', due: '2026-11-01', status: 'open' });
 const errors = validateRopAudit(schema, d);
 assert.ok(errors.some(e => e.field === 'date'));
 assert.ok(errors.some(e => /inexistente/.test(e.message)));
});
