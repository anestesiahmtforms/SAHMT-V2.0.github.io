const ROOT='/SAHMT-V2.0.github.io/';
export function staleModuleFailure(error){return /(?:importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|module.*does not provide an export)/i.test(String(error?.message||''));}
export function repairAppFiles({target='FA',hash=globalThis.location?.hash||'#/home',automatic=false,storage,location=globalThis.location,now=Date.now()}={}){
  if(!['FA','FB'].includes(target)||!/^#\/[a-z0-9/-]*$/i.test(hash)||hash.length>250||globalThis.navigator?.onLine===false)return false;
  if(automatic)try{storage??=globalThis.sessionStorage;const key='sahmt-auth-assets-repair-v237-'+target,previous=Number(storage.getItem(key));if(previous>0&&now-previous<900000)return false;storage.setItem(key,String(now));}catch{return false;}
  location.assign(ROOT+'tools/refresh-app.html?'+new URLSearchParams({target,route:hash}));return true;
}
