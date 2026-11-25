const channelName = 'sahmt-professional-registration';
const changedEvent = 'sahmt:professional-registration-saved';
const refreshIntervalMs = 60_000;

function openChannel(appWindow) {
 try { return typeof appWindow.BroadcastChannel === 'function' ? new appWindow.BroadcastChannel(channelName) : null; }
 catch { return null; }
}

export function announceRegistrationChange(appWindow = globalThis.window) {
 if (!appWindow) return;
 appWindow.dispatchEvent(new appWindow.Event(changedEvent));
 const channel = openChannel(appWindow);
 if (channel) {
  try { channel.postMessage('refresh'); } catch { /* Other screens also refresh from FC. */ }
  finally { channel.close(); }
 }
}

export function watchRegistrationChanges(refresh, {isCurrent, document:doc = globalThis.document} = {}) {
 const appWindow = doc?.defaultView;
 if (!appWindow) return () => {};
 const channel = openChannel(appWindow);
 let stopped = false;
 let running = false;
 let pending = false;
 async function check() {
  if (stopped) return;
  if (!isCurrent()) { stop(); return; }
  if (doc.visibilityState === 'hidden' || appWindow.navigator?.onLine === false) return;
  if (running) { pending = true; return; }
  running = true;
  try { await refresh(); }
  finally {
   running = false;
   if (pending) { pending = false; void tick(); }
  }
 }
 const tick = () => check().catch(() => {});
 const timer = appWindow.setInterval(tick, refreshIntervalMs);
 channel?.addEventListener('message', tick);
 appWindow.addEventListener(changedEvent, tick);
 appWindow.addEventListener('online', tick);
 doc.addEventListener('visibilitychange', tick);
 function stop() {
  if (stopped) return;
  stopped = true;
  appWindow.clearInterval(timer);
  channel?.close();
  appWindow.removeEventListener(changedEvent, tick);
  appWindow.removeEventListener('online', tick);
  doc.removeEventListener('visibilitychange', tick);
 }
 return stop;
}
