import './style.css';
import {initializeApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, inMemoryPersistence, setPersistence} from 'firebase/auth';
import {getFirestore, collection, getDocs} from 'firebase/firestore';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
const app = initializeApp(GOOGLE_PROJECT_CONFIG.FE.config, 'climate-reports-only'), auth = getAuth(app), db = getFirestore(app);
await setPersistence(auth, inMemoryPersistence);
const status = document.querySelector('#status'), reports = document.querySelector('#reports'), login = document.querySelector('#login'), logout = document.querySelector('#logout');
const score = value => value ? `${value.favorable}% favoráveis (${value.numerator}/${value.denominator} respostas válidas)` : 'Suprimido para proteção de grupos pequenos ou ausência de respostas válidas';
let generation = 0;
onAuthStateChanged(auth, async user => {
  const current = ++generation; reports.replaceChildren(); login.hidden = !!user; logout.hidden = !user;
  if (!user) { status.textContent = 'Acesso exclusivo a leitores autorizados no FE.'; return; }
  status.textContent = 'Buscando relatórios…';
  try {
    const [result, actions] = await Promise.all([getDocs(collection(db, 'climateReports')), getDocs(collection(db, 'climateActionReports'))]);
    if (current !== generation) return;
    result.docs.sort((a, b) => b.id.localeCompare(a.id)).forEach(doc => {
      const data = doc.data(), section = document.createElement('section');
      const title = document.createElement('h2'); title.textContent = `Ciclo ${data.survey_cycle}`; section.append(title);
      const metrics = [
        ['Adesão estimada', `${data.participation.percent}% (${data.participation.numerator}/${data.participation.denominator} envios; unicidade por pessoa não verificada)`],
        ['Índice geral', score(data.general)], ...(data.dimensions || []).map(d => [d.label, score(d.score)]),
        ['Segurança psicológica', score(data.psychologicalSafety)], ['Percepção de cultura de segurança', score(data.safetyCulture)],
        ['Intenção de contribuição', score(data.contribution)], ['Confiança no ciclo de melhoria', score(data.improvementTrust)],
        ['Módulo de residentes', score(data.modules?.resident)], ['Módulo de preceptores', score(data.modules?.preceptor)]
      ];
      const plan = actions.docs.find(row => row.id === doc.id)?.data();
      const actionScore = value => value?.denominator ? `${value.percent}% (${value.numerator}/${value.denominator})` : 'Sem denominador informado';
      metrics.push(['Ações concluídas no prazo', actionScore(plan?.onTime)], ['Ações com efetividade verificada', actionScore(plan?.effectiveness)]);
      for (const [label, value] of metrics) { const p = document.createElement('p'); p.className = 'metric'; const strong = document.createElement('strong'); strong.textContent = `${label}: `; p.append(strong, document.createTextNode(value)); section.append(p); }
      const note = document.createElement('p'); note.textContent = 'N/A e itens em branco são excluídos dos denominadores. Não há publicação do módulo administrativo. Compare os ciclos publicados para acompanhar a evolução.'; section.append(note); reports.append(section);
    });
    status.textContent = result.empty ? 'Nenhum ciclo publicado.' : 'Relatórios publicados. A coleta em andamento não é exibida.';
  } catch { if (current === generation) status.textContent = 'Acesso não autorizado ou serviço indisponível. Solicite a permissão de leitura de relatórios no FE.'; }
});
login.onclick = async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch { status.textContent = 'Não foi possível entrar no FE.'; } };
logout.onclick = () => signOut(auth);
