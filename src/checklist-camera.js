const normalizedLabel = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const frontCamera = label => /front|frontal|facetime|avant|vorder|前置|前面/.test(label);

function rearCameraScore(camera) {
  const label = normalizedLabel(camera?.label);
  if (frontCamera(label) || !/back|rear|environment|traseir|traser|posterior|arriere|ruck|rueck|后置|後置|背面/.test(label)) return 0;
  if (/ultra|tele|depth|infrared/.test(label)) return 10;
  if (/triple|dual|dupla|tripla/.test(label)) return 20;
  return /wide|grande.angular|principal|main/.test(label) ? 80 : 70;
}

export function checklistRearCameras(devices = []) {
  const unique = new Map();
  for (const device of devices) {
    if (device.kind === 'videoinput' && device.deviceId && !frontCamera(normalizedLabel(device.label))) unique.set(device.deviceId, device);
  }
  const cameras = [...unique.values()];
  return cameras.some(camera => rearCameraScore(camera) > 0) ? cameras.filter(camera => rearCameraScore(camera) > 0) : cameras;
}

export function preferredChecklistCamera(devices, currentDeviceId = '') {
  return checklistRearCameras(devices).filter(camera => rearCameraScore(camera) >= 70)
    .sort((a, b) => rearCameraScore(b) - rearCameraScore(a) || Number(b.deviceId === currentDeviceId) - Number(a.deviceId === currentDeviceId))[0] || null;
}

async function cameraDevices(mediaDevices, {setTimer, clearTimer}) {
  if (typeof mediaDevices.enumerateDevices !== 'function') return [];
  let timer;
  try {
    // Device discovery is optional; a stalled Safari call must not block the camera.
    return await Promise.race([Promise.resolve().then(() => mediaDevices.enumerateDevices()),
      new Promise(resolve => { timer = setTimer(() => resolve([]), 700); })]) || [];
  } catch { return []; }
  finally { clearTimer(timer); }
}

/** Prefer an identifiable physical rear camera, while preserving permission and session lifecycle. */
export async function openChecklistCamera({mediaDevices, isCurrent, deviceId = '', setTimer = setTimeout, clearTimer = clearTimeout}) {
  const stop = stream => stream?.getTracks().forEach(track => track.stop());
  const unavailableIds = new Set();
  const request = async id => {
    if (!isCurrent()) return null;
    const stream = await mediaDevices.getUserMedia({audio: false, video: {
      ...(id ? {deviceId: {exact: id}} : {facingMode: {ideal: 'environment'}}),
      width: {ideal: 1920}, height: {ideal: 1080}, frameRate: {ideal: 30, max: 30}
    }});
    if (!isCurrent()) { stop(stream); return null; }
    return stream;
  };
  const requestWithFallback = async id => {
    try { return await request(id); }
    catch (error) {
      if (!id || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
      unavailableIds.add(id);
      return request('');
    }
  };
  let devices = await cameraDevices(mediaDevices, {setTimer, clearTimer});
  if (!isCurrent()) return null;
  let selectedId = deviceId || preferredChecklistCamera(devices)?.deviceId || '';
  let stream = await requestWithFallback(selectedId);
  if (!stream) return null;
  try {
    if (!devices.some(device => device.label)) devices = await cameraDevices(mediaDevices, {setTimer, clearTimer});
    if (!isCurrent()) { stop(stream); return null; }
    const track = stream.getVideoTracks()[0];
    let currentId = selectedId || devices.find(device => device.label && device.label === track?.label)?.deviceId || '';
    try { currentId = track?.getSettings?.().deviceId || currentId; } catch { /* Keep the requested ID. */ }
    const preferred = deviceId ? null : preferredChecklistCamera(devices, currentId);
    if (preferred && !unavailableIds.has(preferred.deviceId) && preferred.deviceId !== currentId && preferred.label !== track?.label) {
      // iOS may expose camera labels only after permission. Release before switching lenses.
      stop(stream); stream = null;
      selectedId = preferred.deviceId;
      stream = await requestWithFallback(selectedId);
      if (!stream) return null;
    }
    let activeDeviceId = devices.find(device => device.label && device.label === stream.getVideoTracks()[0]?.label)?.deviceId || selectedId;
    try { activeDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || activeDeviceId; } catch { /* Optional API. */ }
    return {stream, cameras: checklistRearCameras(devices), deviceId: activeDeviceId};
  } catch (error) { stop(stream); throw error; }
}
