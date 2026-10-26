import fs from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {firebaseFbConfig} from '../src/firebase-config-fb.js';

const port=9031,origin=`http://localhost:${port}`,nonce=randomBytes(32).toString('hex'),base='/validation/'+nonce;
const endpoint='https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/training';
const remoteOrigin='https://anestesiahmtforms.github.io';
const readOnly=new Set(['LIST','OPEN','CONTENT','EDIT','AUDIT_LIST','SCORE']);
const manifest=JSON.parse(await fs.readFile('.local-preview/html-training-import/manifest.private.json','utf8'));
const reportPath='.local-preview/html-training-live-verification.json';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let running=false,completed=false;
function deploy(enabled){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','worker-training/wrangler.toml','--var','HTML_TRAINING_ENABLED:'+enabled],{
  env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'1851e9f4cd5f026371beaa2c5a85f1b8',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error',WRANGLER_LOG_PATH:'.local-preview/wrangler-training-validation.log'},stdio:'ignore'});
 child.on('error',()=>reject(Error('VALIDATION_DEPLOY_START_FAILED')));child.on('close',code=>code===0?resolve():reject(Error('VALIDATION_DEPLOY_FAILED')));
});}
async function remote(action,input,authorization,requestOrigin=remoteOrigin){
 const response=await fetch(endpoint,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},
  body:JSON.stringify({action,input}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 return {status:response.status,data:await response.json(),headers:response.headers};
}
async function administrator(authorization){
 const identity=await verifyTrainingIdentity(authorization,{apiKey:firebaseFbConfig.apiKey});
 const store=createFirestoreStore({getAccessToken:()=>firebaseCliAccountToken('anestesiahmtforms2@gmail.com')});
 const profile=await store.get('users',identity.uid);
 if(!profile||profile.active!==true||profile.access!==true||profile.uid&&profile.uid!==identity.uid||
  !(profile.role==='administrador_app'||profile.permissions?.admin===true))throw Error('VALIDATION_ADMIN_REQUIRED');
 return {identity,profile:{role:profile.role,permissions:{admin:profile.permissions?.admin===true}}};
}
async function validate(authorization,identity){
 const report={projectId:firebaseFbConfig.projectId,endpoint,operatorUid:identity.uid,checks:[],trainingWrites:0,scoreWrites:0};
 const check=(value,code)=>{if(!value)throw Error(code);report.checks.push(code);};
 let activated=false;
 try{
  await deploy(true);activated=true;
  const anonymous=await remote('LIST',{},null);check(anonymous.status===401&&anonymous.data.code==='TRAINING_SESSION_INVALID','ANONYMOUS_DENIED');
  const foreign=await remote('LIST',{},authorization,'https://untrusted.example');check(foreign.status===403,'FOREIGN_ORIGIN_DENIED');
  const list=await remote('LIST',{},authorization);check(list.status===200,'AUTHENTICATED_CATALOG');
  check(list.headers.get('Cache-Control')==='no-store','NO_STORE');
  check(list.data.trainings?.length===manifest.trainings.length&&list.data.trainings.every(t=>t.status==='DRAFT'),'ALL_MATERIALS_DRAFT');
  check(!JSON.stringify(list.data).includes('correctOptionId'),'CATALOG_NO_ANSWER_KEY');
  const audit=manifest.trainings.find(t=>t.auditSchema);
  const largest=[...manifest.trainings].sort((a,b)=>Buffer.byteLength(JSON.stringify(b.sections))-Buffer.byteLength(JSON.stringify(a.sections)))[0];
  for(const [label,item]of [['ROP',audit],['ILLUSTRATED',largest]]){
   const opened=await remote('OPEN',{trainingId:item.trainingId},authorization);
   check(opened.status===200&&opened.data.questions.length===5&&!JSON.stringify(opened.data.questions).includes('correctOptionId'),label+'_FIVE_PUBLIC_QUESTIONS');
   const content=await remote('CONTENT',{trainingId:item.trainingId,version:1},authorization);
   check(content.status===200&&hash(content.data.sections)===hash(item.sections),label+'_CONTENT_ROUNDTRIP');
  }
  const edit=await remote('EDIT',{trainingId:audit.trainingId},authorization);
  check(edit.status===200&&edit.data.bank.length===audit.bank.length&&!!edit.data.auditSchema,'ADMIN_EDITOR_PRIVATE_BANK_AND_AUDIT');
  const audits=await remote('AUDIT_LIST',{trainingId:audit.trainingId},authorization);check(audits.status===200&&Array.isArray(audits.data.audits),'ADMIN_AUDIT_LIST');
  const score=await remote('SCORE',{},authorization);check(score.status===200&&score.data.score.uid===identity.uid,'OWN_PERFORMANCE_READ');
  report.trainings=list.data.trainings.length;report.verified=true;report.serviceEnabled=true;
  const configPath='worker-training/wrangler.toml';
  const config=await fs.readFile(configPath,'utf8');await fs.writeFile(configPath,config.replace('HTML_TRAINING_ENABLED = "false"','HTML_TRAINING_ENABLED = "true"'));
  completed=true;
 }catch(error){
  report.error=error.message;
  if(activated){try{await deploy(false);report.serviceEnabled=false;report.rolledBack=true;}catch{report.rollbackRequired=true;}}
  throw Object.assign(error,{report});
 }finally{
  report.completedAt=new Date().toISOString();await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 }
 return report;
}
async function body(req){
 let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>20000)throw Error('VALIDATION_INPUT_TOO_LARGE');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB',projectId:firebaseFbConfig.projectId})},
 server:{host:'localhost',port,strictPort:true,cors:{origin},fs:{strict:true,deny:['.env','.env.*','**/.git/**','**/.local-preview/**']}}});
server.middlewares.use(async(req,res,next)=>{
 if(!req.url?.startsWith('/validation/'))return next();
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const send=(value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(req.headers.host!==`localhost:${port}`||!req.url.startsWith(base))return send({code:'VALIDATION_NOT_FOUND'},404);
 if(req.method==='GET'&&req.url===base){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(`<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validação de treinamentos FB</title><style>body{font:16px/1.6 system-ui;color:#183e48;background:#f4f7f6;margin:0;padding:24px}main{max-width:1100px;margin:auto}header{background:white;border-radius:16px;padding:24px;margin-bottom:24px}h1{line-height:1.2}button{border:0;background:#126578;color:white;padding:14px 22px;border-radius:8px;font:inherit;cursor:pointer}button:disabled{opacity:.6}.success{background:#e1f4e8;padding:16px}.error{background:#ffe6df;padding:16px}</style><main><header><h1>Validar treinamentos de FB</h1><p>Entre com uma conta administradora já cadastrada em FB. O teste confere os rascunhos e o serviço; nenhuma avaliação ou pontuação será gravada.</p><button id="login">Entrar com Google e validar</button><p id="status" role="status">Aguardando seu login. Esta sessão de teste fica somente na memória.</p></header><div id="reader"></div></main><script type="application/json" id="validation-config">${JSON.stringify({base,nonce})}</script><script type="module" src="/tools/html-training-validation.js"></script></html>`);
 }
 if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-validation-nonce']!==nonce)return send({code:'VALIDATION_REQUEST_DENIED'},403);
 try{
  const input=await body(req);const {identity,profile}=await administrator(req.headers.authorization);
  if(req.url===base+'/run'){
   if(running)return send({code:'VALIDATION_IN_PROGRESS'},409);running=true;
   try{const report=await validate(req.headers.authorization,identity);return send({profile,report});}finally{running=false;}
  }
  if(req.url===base+'/api'){
   if(!completed)return send({code:'VALIDATION_NOT_READY'},409);
   if(!readOnly.has(input.action))return send({code:'VALIDATION_READ_ONLY',message:'Esta validação permite somente leitura. Nenhuma avaliação, edição ou pontuação será gravada.'},403);
   const result=await remote(input.action,input.input||{},req.headers.authorization);return send(result.data,result.status);
  }
  return send({code:'VALIDATION_NOT_FOUND'},404);
 }catch(error){return send({code:error.code||error.message,message:'Não foi possível concluir a validação: '+(error.code||error.message)},400);}
});
await server.listen();
await fs.writeFile('.local-preview/html-training-validation-session.json',JSON.stringify({url:origin+base,startedAt:new Date().toISOString(),expiresInMinutes:30},null,2)+'\n');
console.log(JSON.stringify({url:origin+base,status:'WAITING_FOR_GOOGLE_LOGIN',trainingWrites:0,scoreWrites:0}));
setTimeout(()=>server.close().then(()=>process.exit(0)),30*60*1000).unref();
