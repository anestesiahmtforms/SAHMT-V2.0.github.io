import {initializeApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,GoogleAuthProvider,signInWithPopup,browserPopupRedirectResolver} from 'firebase/auth';
import {firebaseFbConfig} from '../src/firebase-config-fb.js';
import {mountHtmlTrainings} from '../src/html-training.js';

const config=JSON.parse(document.querySelector('#validation-config').textContent);
const root=document.querySelector('#reader'),status=document.querySelector('#status'),login=document.querySelector('#login');
const app=initializeApp(firebaseFbConfig,'sahmt-training-local-validation');
const auth=initializeAuth(app,{persistence:inMemoryPersistence,popupRedirectResolver:browserPopupRedirectResolver});
let cleanup;
const inspectionActions=new Set(['catalog','category','open','edit','audit','previous']);
const lockWrites=new MutationObserver(()=>{
 for(const button of root.querySelectorAll('button[data-ht],button[data-save],button[data-finish]')){
  if(button.dataset.ht&&inspectionActions.has(button.dataset.ht))continue;
  button.dataset.locked='true';button.disabled=true;button.title='Somente conferência: gravações bloqueadas nesta validação.';
 }
});
lockWrites.observe(root,{childList:true,subtree:true});
async function request(path,body,user){
 const response=await fetch(config.base+path,{method:'POST',headers:{'Content-Type':'application/json',
  'X-Validation-Nonce':config.nonce,Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify(body),cache:'no-store'});
 const result=await response.json();if(!response.ok)throw Object.assign(Error(result.message||result.code||'A verificação não foi concluída.'),{code:result.code,status:response.status});
 return result;
}
login.addEventListener('click',async()=>{
 login.disabled=true;status.textContent='Aguardando o login Google de FB…';status.className='';
 try{
  const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  const {user}=await signInWithPopup(auth,provider,browserPopupRedirectResolver);
  status.textContent='Sessão confirmada. Conferindo o serviço na Cloudflare; aguarde até 1 minuto…';
  const result=await request('/run',{},user);
  status.textContent=`Validação concluída: ${result.report.trainings} rascunhos. Catálogo, texto, banco privado, auditoria e desempenho responderam. Você pode conferir o editor abaixo; os botões de gravação ficam bloqueados nesta validação.`;
  status.className='success';login.hidden=true;
  cleanup=mountHtmlTrainings(root,{user,profile:result.profile,api:async(action,input)=>request('/api',{action,input},user)});
 }catch(error){status.textContent=error.message;status.className='error';login.disabled=false;}
});
window.addEventListener('pagehide',()=>{lockWrites.disconnect();cleanup?.();},{once:true});
