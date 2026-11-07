import {createOperationalDomainWorker} from '../worker-operational-domain/worker.js';
import {createWorker as createImageWorker} from '../worker-label-ai/worker.js';

/** FH owns both the FA session exchange and the label image reader. */
export function createLabelsWorker({sessionWorker=createOperationalDomainWorker(),imageWorker=createImageWorker({projectId:'sahmt-etiquetas-fh'})}={}) {
 return {async fetch(request,env,ctx){
  if(env?.MODULE_STATION!=='FH'||env.MODULE_PROJECT_ID!=='sahmt-etiquetas-fh')return Response.json({error:{code:'DOMAIN_CONFIG_REQUIRED'}},{status:503,headers:{'Cache-Control':'no-store'}});
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return Response.json({station:'FH',projectId:'sahmt-etiquetas-fh',loginAuthority:'FA',cutoverActive:env.MODULE_CUTOVER_ACTIVE==='true'},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(path==='/v1/labels/extract'){
   if(env.MODULE_CUTOVER_ACTIVE!=='true'||!env.OPENAI_API_KEY)return Response.json({error:{code:'LABELS_NOT_ACTIVE',message:'A leitura por IA de Etiquetas está em preparação.'}}, {status:503,headers:{'Cache-Control':'no-store','Vary':'Origin',...(request.headers.get('Origin')==='https://anestesiahmtforms.github.io'?{'Access-Control-Allow-Origin':'https://anestesiahmtforms.github.io'}:{})}});
   return imageWorker.fetch(request,env,ctx);
  }
  return sessionWorker.fetch(request,env,ctx);
 }};
}
export default createLabelsWorker();
