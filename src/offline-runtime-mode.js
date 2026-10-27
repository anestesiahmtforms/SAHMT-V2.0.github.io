let forcedOffline = false;

export function setOfflineRuntimeMode(value) {
  forcedOffline = value === true;
}

export function isOfflineRuntimeForced() {
  return forcedOffline;
}

export function shouldQueueOfflineOperationalWrite() {return false;}
