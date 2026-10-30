import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistRearCameras, preferredChecklistCamera, openChecklistCamera} from '../src/checklist-camera.js';

const device = (deviceId, label) => ({kind: 'videoinput', deviceId, label});
const cameras = [device('front', 'Front Camera'), device('ultra', 'Back Ultra Wide Camera'),
  device('virtual', 'Back Triple Camera'), device('tele', 'Back Telephoto Camera'), device('main', 'Back Camera')];
function streamFor(id, label = cameras.find(camera => camera.deviceId === id)?.label) {
  const track = {label, stopped: false, stop() {this.stopped = true;}, getSettings: () => ({deviceId: id})};
  return {track, getTracks: () => [track], getVideoTracks: () => [track]};
}
const drain = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
function mediaHarness({firstDevices = cameras, permittedDevices = cameras} = {}) {
  const requests = [], streams = [];
  const mediaDevices = {
    enumerateDevices: async () => requests.length ? permittedDevices : firstDevices,
    getUserMedia: async constraints => {
      requests.push(constraints);
      const stream = streamFor(constraints.video.deviceId?.exact || 'ultra'); streams.push(stream); return stream;
    }
  };
  return {mediaDevices, requests, streams};
}

test('prefers the identifiable physical main rear camera over ultra, tele, virtual and front cameras', () => {
  assert.equal(preferredChecklistCamera(cameras).deviceId, 'main');
  assert.equal(checklistRearCameras(cameras).some(camera => camera.deviceId === 'front'), false);
});
test('recognizes localized rear labels without choosing ultra or tele lenses', () => {
  for (const [main, ultra] of [['Câmera Traseira', 'Câmera Traseira Ultra-angular'],
    ['Cámara trasera', 'Cámara trasera ultra gran angular'], ['Caméra arrière', 'Caméra arrière ultra grand-angle']]) {
    assert.equal(preferredChecklistCamera([device('ultra', ultra), device('main', main)]).deviceId, 'main');
  }
});
test('keeps the current camera among equally suitable physical rear cameras', () => {
  assert.equal(preferredChecklistCamera([device('a', 'Back Camera'), device('b', 'Back Camera')], 'b').deviceId, 'b');
});
test('does not guess a main camera from blank, virtual-only or unknown labels', () => {
  for (const devices of [[device('unknown', '')], [device('virtual', 'Back Triple Camera')], [device('usb', 'USB Camera')]]) {
    assert.equal(preferredChecklistCamera(devices), null);
  }
});
test('requests the known main lens directly with ideal resolution and bounded frame rate', async () => {
  const h = mediaHarness();
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true});
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].video.deviceId.exact, 'main');
  assert.equal(h.requests[0].video.width.ideal, 1920); assert.equal(h.requests[0].video.frameRate.max, 30);
  assert.equal(h.requests[0].audio, false); assert.equal(result.deviceId, 'main');
  assert.equal(result.stream.track.stopped, false);
});
test('after first permission releases the default ultra lens before requesting the main lens', async () => {
  const h = mediaHarness({firstDevices: cameras.map(camera => ({...camera, label: ''}))});
  const getUserMedia = h.mediaDevices.getUserMedia;
  h.mediaDevices.getUserMedia = constraints => {
    if (h.requests.length) assert.equal(h.streams[0].track.stopped, true);
    return getUserMedia(constraints);
  };
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true});
  assert.equal(h.requests[0].video.facingMode.ideal, 'environment');
  assert.equal(h.requests[1].video.deviceId.exact, 'main'); assert.equal(result.deviceId, 'main');
  assert.equal(h.streams[0].track.stopped, true); assert.equal(result.stream.track.stopped, false);
});
test('manual lens choice is respected instead of automatically switching back', async () => {
  const h = mediaHarness();
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true, deviceId: 'ultra'});
  assert.equal(h.requests.length, 1); assert.equal(result.deviceId, 'ultra');
});
test('missing enumerateDevices still opens the environment camera', async () => {
  const h = mediaHarness(); delete h.mediaDevices.enumerateDevices;
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true});
  assert.equal(h.requests.length, 1); assert.equal(result.stream, h.streams[0]);
});
test('enumeration failure is optional and never disables scanning', async () => {
  const h = mediaHarness(); h.mediaDevices.enumerateDevices = async () => {throw new Error('Unavailable');};
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true});
  assert.ok(result.stream); assert.equal(h.requests.length, 1);
});
test('removed exact device falls back once without repeatedly retrying the unavailable lens', async () => {
  const h = mediaHarness(); const getUserMedia = h.mediaDevices.getUserMedia; let exactAttempts = 0;
  h.mediaDevices.getUserMedia = constraints => {
    if (constraints.video.deviceId) {exactAttempts++; return Promise.reject(Object.assign(new Error('Gone'), {name: 'OverconstrainedError'}));}
    return getUserMedia(constraints);
  };
  const result = await openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true});
  assert.equal(exactAttempts, 1); assert.equal(result.deviceId, 'ultra');
});
test('permission denial is surfaced without a second permission request', async () => {
  const h = mediaHarness(); let attempts = 0;
  h.mediaDevices.getUserMedia = async () => {attempts++; throw Object.assign(new Error('Denied'), {name: 'NotAllowedError'});};
  await assert.rejects(openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true}), {name: 'NotAllowedError'});
  assert.equal(attempts, 1);
});
test('canceling while camera discovery is pending never asks for camera access', async () => {
  const h = mediaHarness(), gate = deferred(); let current = true;
  h.mediaDevices.enumerateDevices = () => gate.promise;
  const opening = openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => current});
  await drain(); current = false; gate.resolve(cameras);
  assert.equal(await opening, null); assert.equal(h.requests.length, 0);
});
test('canceling while switching lenses releases the late arriving stream', async () => {
  const h = mediaHarness({firstDevices: []}), gate = deferred(); let current = true;
  const getUserMedia = h.mediaDevices.getUserMedia;
  h.mediaDevices.getUserMedia = constraints => constraints.video.deviceId ? gate.promise : getUserMedia(constraints);
  const opening = openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => current});
  await drain(); assert.equal(h.streams[0].track.stopped, true);
  current = false; const late = streamFor('main'); gate.resolve(late);
  assert.equal(await opening, null); assert.equal(late.track.stopped, true);
});
test('stalled discovery is bounded and cannot hold the camera opening indefinitely', async () => {
  const h = mediaHarness(), timers = new Map(); let id = 0;
  h.mediaDevices.enumerateDevices = () => new Promise(() => {});
  const opening = openChecklistCamera({mediaDevices: h.mediaDevices, isCurrent: () => true,
    setTimer: (fn, delay) => {assert.equal(delay, 700); timers.set(++id, fn); return id;}, clearTimer: id => timers.delete(id)});
  await drain(); timers.values().next().value(); await drain();
  timers.values().next().value(); const result = await opening;
  assert.ok(result.stream); assert.equal(timers.size, 0);
});
