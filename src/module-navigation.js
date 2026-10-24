const KEY = 'sahmt-module-navigation-v1';
const BASE = '/SAHMT-V2.0.github.io/';
const PATHS = new Set([BASE, BASE + 'gestao/']);
const MAX_AGE = 30000;
const RETURN_KEY='sahmt-management-return-v1';

export function rememberManagementReturn(hash=globalThis.location?.hash,{storage,now=Date.now()}={}){
  if(!/^#\/(?:management(?:\/area-[a-z0-9-]+)?|training)$/.test(hash||''))return false;
  try{(storage??globalThis.sessionStorage).setItem(RETURN_KEY,JSON.stringify({hash,at:now}));return true;}catch{return false;}
}
export function consumeManagementReturn({storage,now=Date.now()}={}){
  try{storage??=globalThis.sessionStorage;const raw=storage.getItem(RETURN_KEY);storage.removeItem(RETURN_KEY);if(!raw)return null;const value=JSON.parse(raw);
    return /^#\/(?:management(?:\/area-[a-z0-9-]+)?|training)$/.test(value.hash||'')&&Number.isSafeInteger(value.at)&&value.at<=now&&now-value.at<600000?value.hash:null;
  }catch{return null;}
}
export function hasManagementReturn({storage,now=Date.now()}={}){
  try{storage??=globalThis.sessionStorage;const value=JSON.parse(storage.getItem(RETURN_KEY)||'null');return Boolean(value&&/^#\/(?:management(?:\/area-[a-z0-9-]+)?|training)$/.test(value.hash||'')&&Number.isSafeInteger(value.at)&&value.at<=now&&now-value.at<600000);}catch{return false;}
}

// An animation hint only: sessions and access are still verified normally.
export function rememberModuleNavigation(targetPath, {storage, pathname = globalThis.location?.pathname, now = Date.now()} = {}) {
  if (!PATHS.has(pathname) || !PATHS.has(targetPath) || targetPath === pathname) return false;
  try { (storage ?? globalThis.sessionStorage).setItem(KEY, JSON.stringify({from: pathname, to: targetPath, at: now})); return true; } catch { return false; }
}

export function consumeModuleNavigation({storage, pathname = globalThis.location?.pathname, now = Date.now()} = {}) {
  try {
    storage ??= globalThis.sessionStorage;
    const raw = storage.getItem(KEY); storage.removeItem(KEY);
    if (!raw) return false;
    const hint = JSON.parse(raw);
    return PATHS.has(hint.from) && PATHS.has(hint.to) && hint.from !== hint.to && hint.to === pathname
      && Number.isSafeInteger(hint.at) && hint.at <= now && now - hint.at <= MAX_AGE;
  } catch { return false; }
}
