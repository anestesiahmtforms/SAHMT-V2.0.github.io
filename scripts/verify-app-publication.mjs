import {APP_RELEASE_URL,validateAppPublication} from './lib/app-publication.js';
const expected=validateAppPublication({schema:1,appVersion:process.env.APP_VERSION,release:Number(process.env.APP_RELEASE),sourceRevision:process.env.GITHUB_SHA});
let verified=false;
for(let attempt=0;attempt<20;attempt++){
 try{
  const response=await fetch(APP_RELEASE_URL+'?published='+expected.sourceRevision+'-'+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  const value=response.ok?await response.json():null;
  if(value?.schema===1&&value.appVersion===expected.appVersion&&value.sourceRevision===expected.sourceRevision&&value.targets?.FA===expected.release&&value.targets?.FB===expected.release){verified=true;break;}
 }catch{/* Publication may still be propagating; never declare it verified early. */}
 if(attempt<19)await new Promise(resolve=>setTimeout(resolve,3000));
}
if(!verified)throw Error('APP_PUBLICATION_PUBLIC_VERIFICATION_FAILED');
console.log('APP_PUBLICATION_VERIFIED '+expected.appVersion+' '+expected.release+' '+expected.sourceRevision);
