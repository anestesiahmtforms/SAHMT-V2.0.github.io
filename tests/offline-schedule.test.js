import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheOfflineScheduleImages, offlineScheduleGalleryMarkup, OFFLINE_SCHEDULE_IMAGES} from '../src/offline-schedule.js';

test('offline schedule gallery contains the six day sheets and the 2026 vacation sheet', () => {
  assert.equal(OFFLINE_SCHEDULE_IMAGES.length, 7);
  assert.deepEqual(OFFLINE_SCHEDULE_IMAGES.map(({id}) => id), ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'ferias']);
  const markup = offlineScheduleGalleryMarkup('/SAHMT-V2.0.github.io/');
  for (const {id, file, alt} of OFFLINE_SCHEDULE_IMAGES) {
    assert.match(markup, new RegExp(`offline-schedule-${id}`));
    assert.match(markup, new RegExp(file));
    assert.match(markup, new RegExp(alt));
  }
  assert.match(markup, /não recebe atualizações do Firestore/);
});

test('preparing the offline gallery fetches every same-origin image and reports full success', async () => {
  const urls = [];
  let status = '';
  const result = await cacheOfflineScheduleImages({
    baseUrl: '/SAHMT-V2.0.github.io/',
    fetchImage: async (url) => { urls.push(url); },
    onStatus: (value) => { status = value; }
  });
  assert.equal(result.cached, 7);
  assert.equal(result.total, 7);
  assert.equal(urls.length, 7);
  assert.ok(urls.every((url) => url.startsWith('/SAHMT-V2.0.github.io/assets/offline-schedule/')));
  assert.match(status, /sete imagens.*consulta offline/);
});

test('preparation reports a partial result when one static image is unavailable', async () => {
  let status = '';
  const result = await cacheOfflineScheduleImages({
    baseUrl: '/',
    fetchImage: async (url) => { if (url.includes('terca-2026')) throw new Error('offline'); },
    onStatus: (value) => { status = value; }
  });
  assert.equal(result.cached, 6);
  assert.match(status, /6 de 7/);
});
