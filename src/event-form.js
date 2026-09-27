import {isValidDateKey} from './schedule-date.js';

const eventTypes = new Set(['pessoal', 'ferias', 'atraso', 'suporte', 'gestao', 'congresso', 'saude', 'ausencia', 'outros']);

export function normalizeEventType(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function eventFieldRules(value) {
  const type = normalizeEventType(value);
  if (type === 'atraso') return {memberStatus: true, description: false, delayMultiple: true, substitute: false, shift: false, disableSubstitute: true, payerMode: 'member', creditorMode: 'team', amountMode: 'delay'};
  if (type === 'suporte') return {memberStatus: false, description: false, delayMultiple: false, substitute: true, shift: true, disableSubstitute: false, payerMode: 'team', creditorMode: 'substitute', amountMode: 'shift'};
  if (['gestao', 'congresso', 'pessoal', 'ferias', 'saude', 'ausencia'].includes(type)) {
    const personal = ['pessoal', 'ferias', 'saude', 'ausencia'].includes(type);
    return {
      memberStatus: true, description: false, delayMultiple: false, substitute: true, shift: true, disableSubstitute: false,
      payerMode: personal ? 'member' : 'team', creditorMode: 'substitute',
      amountMode: type === 'ausencia' ? 'manual' : 'shift'
    };
  }
  if (type === 'outros') return {memberStatus: true, description: true, delayMultiple: true, substitute: true, shift: true, disableSubstitute: false, payerMode: 'manual', creditorMode: 'substitute', amountMode: 'manual'};
  return {memberStatus: true, description: false, delayMultiple: false, substitute: true, shift: false, disableSubstitute: false, payerMode: 'manual', creditorMode: 'manual', amountMode: 'manual'};
}

export function validateEventForm(values) {
  const type = normalizeEventType(values.eventType);
  if (!eventTypes.has(type)) throw new Error('Selecione um tipo de evento válido.');
  if (!isValidDateKey(String(values.eventDate || ''))) throw new Error('Informe uma data válida para o evento.');
  const rules = eventFieldRules(type);
  if (rules.memberStatus && !String(values.memberStatus || '').trim()) throw new Error('Informe o membro e a situação para este tipo de evento.');
  if (rules.description && !String(values.description || '').trim()) throw new Error('Descreva o evento Outros.');
  if (rules.delayMultiple && !/^[0-6]$/.test(String(values.delayMultiple ?? ''))) throw new Error('Selecione um múltiplo de atraso entre 0 e 6.');
  if (rules.substitute && !String(values.substitute || '').trim()) throw new Error('Informe o substituto para este tipo de evento.');
  if (rules.shift && !String(values.shift || '').trim()) throw new Error('Informe o turno para este tipo de evento.');
  if (!String(values.payer || '').trim()) throw new Error('Informe o pagador.');
  if (!String(values.creditor || '').trim()) throw new Error('Informe o credor.');
  const amountInput = String(values.amountToPay ?? '').trim();
  const amount = Number(amountInput);
  if (!amountInput || !Number.isFinite(amount) || amount < 0) throw new Error('Informe um valor válido, igual ou maior que zero.');
  return true;
}
