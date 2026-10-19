export async function subscribeReportWithDeadline({scope, callbacks, subscribe, onTimeout = () => {}, timeoutMs = 7000}) {
  let closed = false, stopped = false, stopRemote = null, timer;
  const confirmed = new Set(), required = scope.sourceKeys || ['report'];
  const active = () => !closed && callbacks.isCurrent?.() !== false;
  const stop = () => {if (stopped || !stopRemote) return; stopped = true; stopRemote();};
  const close = () => {closed = true; clearTimeout(timer); stop();};
  const arm = () => {
    if (timer || !active()) return;
    timer = setTimeout(() => {
      if (!active()) return;
      const error = Object.assign(new Error('Atualização remota não confirmada no prazo. A cópia local foi preservada.'), {code: 'deadline-exceeded'});
      close(); onTimeout(error);
      if (callbacks.isCurrent?.() !== false) callbacks.error(error);
    }, timeoutMs);
  };
  arm();
  try {
    stopRemote = await subscribe({
      ...callbacks, isCurrent: active,
      next(key, event) {
        if (!active()) return;
        if (event.complete && event.fromCache === false && event.hasPendingWrites !== true) confirmed.add(key); else confirmed.delete(key);
        if (required.every(source => confirmed.has(source))) {clearTimeout(timer); timer = null;} else arm();
        callbacks.next(key, event);
      },
      error(error) {if (!active()) return; close(); callbacks.error(error);}
    });
    if (closed) stop();
    return close;
  } catch (error) {close(); throw error;}
}
