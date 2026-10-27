import './style.css';
import {renderReport} from './report-view.js';
import {initializeApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, inMemoryPersistence, setPersistence} from 'firebase/auth';
import {getFirestore, collection, getDocs} from 'firebase/firestore';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
const app=initializeApp(GOOGLE_PROJECT_CONFIG.FE.config,'climate-reports-only'),auth=getAuth(app),db=getFirestore(app);
await setPersistence(auth,inMemoryPersistence);
const status=document.querySelector('#status'),reports=document.querySelector('#reports'),login=document.querySelector('#login'),logout=document.querySelector('#logout');
let generation=0;
onAuthStateChanged(auth,async user=>{
  const current=++generation;reports.replaceChildren();login.hidden=!!user;logout.hidden=!user;
  if(!user){status.textContent='Acesso exclusivo a leitores autorizados no FE.';return;}
  status.textContent='Buscando relatórios…';
  try{
    const [result,actions]=await Promise.all([getDocs(collection(db,'climateReports')),getDocs(collection(db,'climateActionReports'))]);
    if(current!==generation)return;
    result.docs.sort((a,b)=>b.id.localeCompare(a.id)).forEach(doc=>reports.append(renderReport(document,doc.data(),actions.docs.find(row=>row.id===doc.id)?.data())));
    status.textContent=result.empty?'Nenhum ciclo publicado. Os resultados serão separados em equipe, residentes, secretárias e substitutos.':'Relatórios publicados. A coleta em andamento não é exibida.';
  }catch{if(current===generation)status.textContent='Acesso não autorizado ou serviço indisponível. Solicite a permissão de leitura de relatórios no FE.';}
});
login.onclick=async()=>{try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}catch{status.textContent='Não foi possível entrar no FE.';}};
logout.onclick=()=>signOut(auth);
