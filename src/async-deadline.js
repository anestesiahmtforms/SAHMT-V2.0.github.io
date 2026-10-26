// Bound the caller as well as the transport: suspended WebKit operations can
// remain pending even after their underlying connection has disappeared.
export function withinDeadline(action, {timeoutMs, code='deadline-exceeded', onTimeout=()=>{}, setTimer=setTimeout, clearTimer=clearTimeout} = {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimer(() => {
      const error = Object.assign(new Error('A operação não respondeu no prazo.'), {code});
      try {onTimeout(error);} catch {}
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(action), deadline]).finally(() => clearTimer(timer));
}
