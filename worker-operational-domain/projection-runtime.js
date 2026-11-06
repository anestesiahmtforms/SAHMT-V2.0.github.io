import {createHmac, timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {boundedJson, fail} from './identity.js';
import {normalizeProjectionEvent, planEventProjection} from './projection-plan.js';

const ENDPOINT = 'https://sahmt-fj-escala.sahmt-fj-563bc56a.workers.dev/internal/v1/event-projection';
function requireSecret(secret) {if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret || '')) throw fail('DOMAIN_PROJECTION_CONFIG_REQUIRED');}
export function projectionHeaders(body, secret, {now = Date.now} = {}) {
  requireSecret(secret); const timestamp = String(now());
  return {'Content-Type': 'application/json', 'X-Sahmt-Projection-Timestamp': timestamp,
    'X-Sahmt-Projection-Signature': createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')};
}

export async function verifyProjectionRequest(request, secret, {now = Date.now} = {}) {
  requireSecret(secret);
  const timestamp = request.headers.get('X-Sahmt-Projection-Timestamp'), signature = request.headers.get('X-Sahmt-Projection-Signature');
  if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '') ||
      !/^\d{13}$/.test(timestamp || '') || Math.abs(now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature || ''))
    throw fail('DOMAIN_PROJECTION_SIGNATURE_INVALID', 401);
  if (!request.body) throw fail('DOMAIN_PROJECTION_INVALID', 400);
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 8192 || chunks.length >= 128) throw fail('DOMAIN_BODY_LIMIT', 413);
      chunks.push(part.value);
    }
  } finally {await reader.cancel().catch(() => {});}
  const bytes = Buffer.concat(chunks), expected = createHmac('sha256', secret).update(timestamp + '.').update(bytes).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw fail('DOMAIN_PROJECTION_SIGNATURE_INVALID', 401);
  let event; try {event = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {throw fail('DOMAIN_PROJECTION_INVALID', 400);}
  return normalizeProjectionEvent(event);
}

export async function applyEventProjection(event, store) {
  const validated = normalizeProjectionEvent(event);
  return store.transaction(async transaction => {
    const current = await transaction.get('eventProjections', validated.eventId), previous = current?.data || null;
    const dates = [...new Set([previous?.date, validated.date].filter(Boolean))], schedules = {};
    for (const date of dates) {
      // Validate the receipt before constructing a path from its date.
      if (previous) normalizeProjectionEvent(previous);
      const document = await transaction.get('scheduleDays', date); if (document) schedules[date] = document.data;
    }
    const plan = planEventProjection({event: validated, previous, schedules});
    if (plan.status !== 'ALREADY_APPLIED') {
      for (const update of plan.scheduleUpdates) transaction.patchSchedule(update.date, update);
      transaction.setProjection(validated.eventId, plan.receipt);
    }
    return {eventId: validated.eventId, version: plan.receipt.version, status: plan.status};
  });
}

export async function drainEventProjections({station, store, secret, fetchImpl = fetch} = {}) {
  requireSecret(secret);
  const items = await store.listPending(); let completed = 0, failed = 0;
  for (const item of items) {
    try {
      if (station === 'FJ') await applyEventProjection(item.data, store);
      else if (station === 'FI') {
        const source = await store.get('events', item.data.eventId);
        if (!source || !Number.isSafeInteger(item.data.version) || source.data.version < item.data.version) throw fail('DOMAIN_PROJECTION_SOURCE_UNAVAILABLE');
        const event = normalizeProjectionEvent({eventId: item.data.eventId, version: source.data.version, date: source.data.date,
          active: source.data.active, scheduleSigla: source.data.scheduleSigla || '', memberSigla: source.data.memberSigla || '',
          actorUid: source.data.updatedByUid || source.data.createdByUid});
        const body = JSON.stringify(event);
        const response = await fetchImpl(ENDPOINT, {method: 'POST', body, headers: projectionHeaders(body, secret),
          redirect: 'manual', signal: AbortSignal.timeout(20000)});
        const reply = await boundedJson(response, 8192);
        if (!response.ok || reply.eventId !== event.eventId || !Number.isSafeInteger(reply.version) || reply.version < event.version ||
            !['APPLIED', 'ALREADY_APPLIED', 'WAITING_SCHEDULE'].includes(reply.status)) throw fail('DOMAIN_PROJECTION_DELIVERY_UNAVAILABLE');
        await store.transaction(async transaction => {
          const current = await transaction.get('eventProjectionOutbox', item.id);
          if (current?.data.status === 'PENDING') transaction.completeOutbox(item.id, reply.version);
        });
      } else throw fail('DOMAIN_PROJECTION_CONFIG_REQUIRED');
      completed++;
    } catch (error) {
      failed++;
      if (station === 'FI') await store.transaction(async transaction => {
        const current = await transaction.get('eventProjectionOutbox', item.id);
        if (current?.data.status === 'PENDING') transaction.deferOutbox(item.id);
      }).catch(() => {});
      console.warn(JSON.stringify({station, code: /^DOMAIN_[A-Z_]+$/.test(error.code || '') ? error.code : 'DOMAIN_PROJECTION_UNAVAILABLE'}));
    }
  }
  return {station, completed, failed};
}
