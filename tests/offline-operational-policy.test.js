import test from 'node:test';
import assert from 'node:assert/strict';
import {isFirestoreCacheFallbackError as fallbackForNetworkFailure} from '../src/offline-cache.js';

test('erro de transporte unknown com mensagem de rede admite cache, mas unknown de configuração não', () => {
  assert.equal(fallbackForNetworkFailure({code: 'unknown', name: 'FirebaseError', message: 'Failed to fetch'}), true);
  assert.equal(fallbackForNetworkFailure({code: 'auth/network-request-failed'}), true);
  assert.equal(fallbackForNetworkFailure({code: 'unknown', message: 'Configuração inválida'}), false);
  assert.equal(fallbackForNetworkFailure({code: 'permission-denied', message: 'Failed to fetch'}), false);
});
import {isFirestoreCacheFallbackError, isSafeCacheEntryFresh, offlineCacheTtlFor} from '../src/offline-cache.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('Firestore indisponível por quota pode usar cache, mas negativa de permissão não', () => {
  assert.equal(isFirestoreCacheFallbackError({code: 'resource-exhausted'}, {online: true}), true);
  assert.equal(isFirestoreCacheFallbackError({code: 'unavailable'}, {online: true}), true);
  assert.equal(isFirestoreCacheFallbackError({code: 'permission-denied'}, {online: true}), false);
  assert.equal(isFirestoreCacheFallbackError({code: 'unauthenticated'}, {online: false}), false);
});

test('Etiquetas expiram em 24 h e demais módulos operacionais em sete dias', () => {
  assert.equal(offlineCacheTtlFor('labels'), DAY);
  for (const module of ['events', 'checklists', 'scheduleDays', 'contacts', 'stations']) {
    assert.equal(offlineCacheTtlFor(module), 7 * DAY);
  }
});

test('cache só é aceito para mesmo UID e timestamp dentro do TTL', () => {
  const now = 10 * DAY;
  assert.equal(isSafeCacheEntryFresh({uid: 'user-a', kind: 'labels', cachedAt: now - 23 * HOUR}, {uid: 'user-a', kind: 'labels', now}), true);
  assert.equal(isSafeCacheEntryFresh({uid: 'user-a', kind: 'labels', cachedAt: now - 25 * HOUR}, {uid: 'user-a', kind: 'labels', now}), false);
  assert.equal(isSafeCacheEntryFresh({uid: 'user-b', kind: 'events', cachedAt: now}, {uid: 'user-a', kind: 'events', now}), false);
  assert.equal(isSafeCacheEntryFresh({uid: 'user-a', kind: 'events', cachedAt: Number.NaN}, {uid: 'user-a', kind: 'events', now}), false);
  assert.equal(isSafeCacheEntryFresh({uid: 'user-a', kind: 'events'}, {uid: 'user-a', kind: 'events', now}), false);
});
