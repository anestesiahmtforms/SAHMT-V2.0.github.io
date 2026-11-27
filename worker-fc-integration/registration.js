import {Buffer} from 'node:buffer';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
import {assertFolderReadable} from '../server/folder-read-policy.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {createServiceTokenProvider, REGISTRATION_PROJECT, verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {createProfessionalRegistrationService, professionalObligationActions, registrationActor, registrationAdmin} from '../worker-training/professional-registration-service.js';
import {createRegistrationDrive} from '../worker-training/registration-drive.js';
import {verifyRegistrationInvitation} from '../worker-training/registration-invitation.js';

const origin = 'https://anestesiahmtforms.github.io';
const folder = 'consultas/cadastro-profissional';
const drivePath = '/v1/registration-drive';
const professionalPath = '/v1/professional-registration';
const actions = {
 [drivePath]:new Set(['LIST_OWN','LIST_SUBJECT','UPLOAD']),
 [professionalPath]:new Set(['BOOTSTRAP','SAVE','LIST','DETAIL',...professionalObligationActions])
};
const fail = (code, status) => Object.assign(Error(code), {code,status});
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isFcRegistrationPath = path => Object.hasOwn(actions, path);
async function checkFolder(store, profile) {
 if (registrationAdmin(profile)) return;
 const policy = await store.get('runtimePolicy','folders');
 assertFolderReadable(policy,folder);
}

async function readInput(request, max) {
 if (Number(request.headers.get('Content-Length')) > max) throw fail('REGISTRATION_INPUT_TOO_LARGE',413);
 const reader = request.body?.getReader();
 if (!reader) throw fail('REGISTRATION_INVALID_INPUT',400);
 const chunks = [];
 let size = 0;
 try {
  for (;;) {
   const {done,value} = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > max) throw fail('REGISTRATION_INPUT_TOO_LARGE',413);
   chunks.push(value);
  }
 } finally { await reader.cancel().catch(() => {}); }
 try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
 catch { throw fail('REGISTRATION_INVALID_INPUT',400); }
}

function buildRuntime(env, fetchImpl) {
 let credentials, driveConfig;
 try { credentials = JSON.parse(env.FC_REGISTRATION_SERVICE_ACCOUNT_JSON); }
 catch { throw fail('REGISTRATION_UNAVAILABLE',503); }
 if (credentials?.client_email !== 'registration-worker@' + REGISTRATION_PROJECT + '.iam.gserviceaccount.com')
  throw fail('REGISTRATION_UNAVAILABLE',503);
 try { driveConfig = JSON.parse(env.FC_REGISTRATION_DRIVE_CLIENT_JSON); } catch {}
 const getAccessToken = createServiceTokenProvider({credentials,projectId:REGISTRATION_PROJECT,fetchImpl});
 const store = createFirestoreStore({projectId:REGISTRATION_PROJECT,getAccessToken,fetchImpl});
 const professional = createProfessionalRegistrationService({store,verifyInvitation:(invitation,scope)=>verifyRegistrationInvitation(invitation,scope,fetchImpl)});
 const drive = createRegistrationDrive({store,fetchImpl,interactive:false,checkAccess:profile=>checkFolder(store,profile),
  refreshToken:env.FC_REGISTRATION_DRIVE_REFRESH_TOKEN,
  clientConfig:driveConfig ? {...driveConfig,ownerEmail:'anestesiahmtforms@gmail.com',origin} : null});
 return {store,professional,drive};
}

export function createFcRegistrationHandler({fetchImpl = fetch, verify = verifyTrainingIdentity, build = buildRuntime} = {}) {
 const runtimes = new WeakMap();
 return async (request, env, path) => {
  const allowed = request.headers.get('Origin') === origin;
  const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',
   ...(allowed ? {'Access-Control-Allow-Origin':origin} : {})};
  const send = (data,status = 200) => Response.json(data,{status,headers});
  if (!allowed) return send({code:'REGISTRATION_ORIGIN_DENIED'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,
   'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  if (request.method !== 'POST') return send({code:'REGISTRATION_METHOD_DENIED'},405);
  if (env.FC_PROFESSIONAL_REGISTRATION_ENABLED !== 'true') return send({code:'REGISTRATION_UNAVAILABLE'},503);
  try {
   if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw fail('REGISTRATION_INVALID_INPUT',400);
   const isDrive = path === drivePath;
   const body = await readInput(request,isDrive ? 8 * 1024 * 1024 : 64 * 1024);
   if (!object(body) || Object.keys(body).length !== 2 || !Object.hasOwn(body,'action') || !object(body.input) ||
       !actions[path].has(body.action)) throw fail('REGISTRATION_INVALID_INPUT',400);
   const identity = await verify(request.headers.get('Authorization'),{
    apiKey:GOOGLE_PROJECT_CONFIG.FC.config.apiKey,projectId:REGISTRATION_PROJECT,fetchImpl
   });
   if (!runtimes.has(env)) runtimes.set(env,build(env,fetchImpl));
   const {store,professional,drive} = runtimes.get(env);
   if (!isDrive && !professionalObligationActions.has(body.action))
    await checkFolder(store,await registrationActor(store,identity));
   return send(await (isDrive ? drive : professional).execute(body.action,body.input,identity));
  } catch (error) {
   const code = /^REG(?:ISTRATION|DRIVE)_[A-Z_]+$/.test(error.code || '') ? error.code :
    error.code === 'FOLDER_DISABLED' ? 'REGISTRATION_FOLDER_DISABLED' :
    error.status === 401 ? 'REGISTRATION_UNAUTHENTICATED' : 'REGISTRATION_UNAVAILABLE';
   const status = [400,401,403,409,413,422,429,503].includes(error.status) ? error.status : 503;
   return send({code},status);
  }
 };
}
