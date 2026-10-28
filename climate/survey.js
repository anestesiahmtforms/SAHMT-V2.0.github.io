import {mountParticipantGate} from './participant-group.js';
import {COMMON, DIMENSIONS, OPEN, VERSION, CYCLE, groupForModule, questionsForSelection} from '../climate-domain/schema.js';
import './style.css';
import {sendSubmission} from './transport.js';
const app = document.querySelector('#app');
const options = [['1', 'Discordo totalmente'], ['2', 'Discordo'], ['3', 'Nem concordo nem discordo'], ['4', 'Concordo'], ['5', 'Concordo totalmente'], ['NA', 'Não se aplica / não tenho informação']];
const renderQuestion = q => `<fieldset><legend>${q.id}. ${q.text}</legend><div class="options">${options.map(([value, label]) => `<label><input type="radio" name="${q.id}" value="${value}"><span>${value === 'NA' ? 'N/A' : value} · ${label}</span></label>`).join('')}</div><button type="button" class="clear" data-clear="${q.id}">Limpar resposta</button></fieldset>`;
app.innerHTML = `<header><p class="eyebrow">SAHMT · ENQUETES E CONSULTAS</p><h1>Pesquisa de clima organizacional</h1><p>Ciclo ${CYCLE} · últimos 6 meses · 8–12 minutos</p></header>
<section class="notice"><h2>Antes de começar</h2><p>Seu acesso utiliza a autenticação do app. As respostas ficam vinculadas ao seu cadastro e são organizadas automaticamente na sua categoria para os indicadores institucionais. As respostas não serão utilizadas para avaliação de desempenho. Não inclua dados de pacientes nos comentários.</p><p>Este instrumento institucional não é um questionário oficial ou validado pela Accreditation Canada.</p></section>
<section id="participant-gate"></section><form hidden>
<p>Você pode deixar itens em branco ou marcar N/A. Para enviar, responda pelo menos um item comum de 1 a 5.</p><p id="progress" role="status"></p>
${DIMENSIONS.map(([label], i) => `<section><h2>${i + 1}. ${label}</h2>${COMMON.slice(i * 4, i * 4 + 4).map(renderQuestion).join('')}</section>`).join('')}
<section id="module" hidden></section><section><h2>Comentários opcionais</h2><p>Evite nomes, datas exatas, casos clínicos ou detalhes que identifiquem você ou outras pessoas. Não use este formulário para urgências ou notificações assistenciais.</p>${OPEN.map(q => `<label class="open">${q.id}. ${q.text}<textarea name="${q.id}" maxlength="1500" rows="3"></textarea></label>`).join('')}</section>
<p>Responda uma vez por ciclo. Em caso de falha, tente reenviar nesta mesma página.</p><button type="submit" class="primary">Enviar respostas</button><p id="status" role="status" aria-live="polite"></p></form>`;
const form = app.querySelector('form'), status = app.querySelector('#status');
// Keep the response in memory until the authenticated commit is confirmed.
let submissionId = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
const commentToken = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
let pendingPayload = null, sending = false, participantGroup=null, participant=null;
function updateProgress() {
  app.querySelector('#progress').textContent = `${COMMON.filter(q => form.querySelector(`input[name="${q.id}"]:checked`)).length} de 32 itens comuns respondidos.`;
}
mountParticipantGate(app.querySelector('#participant-gate'),form,(group,identity)=>{
  participant=identity;
  participantGroup=group;
  const qs=questionsForSelection(group),host=app.querySelector('#module');
  host.hidden=qs.length===0;
  host.innerHTML=qs.length?'<h2>Perguntas para sua função</h2>'+(group==='team'?'<p>Sobre preceptoria: se a atividade não se aplica a você, marque N/A.</p>':'')+qs.map(renderQuestion).join(''):'';
});
form.addEventListener('change', updateProgress);
form.addEventListener('click', event => {
  const id = event.target.closest('[data-clear]')?.dataset.clear;
  if (id) { form.querySelectorAll(`input[name="${id}"]`).forEach(input => { input.checked = false; }); updateProgress(); }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  if (!pendingPayload) {
    const data = new FormData(form), answers = {}, comments = {};
    if (!participantGroup) { status.textContent = 'Confirme seu cadastro para continuar.'; return; }
    for (const q of [...COMMON, ...questionsForSelection(participantGroup)]) {
      const value = data.get(q.id);
      if (value) answers[q.id] = value === 'NA' ? 'NA' : Number(value);
    }
    if (!COMMON.some(q => Number.isInteger(answers[q.id]))) { status.textContent = 'Responda pelo menos um item comum de 1 a 5.'; return; }
    for (const q of OPEN) if (data.get(q.id)?.trim()) comments[q.id] = data.get(q.id).trim();
    pendingPayload = {survey_version: VERSION, survey_cycle: CYCLE, submission_id: submissionId, answers, comments, group: participantGroup};
  }
  sending = true;
  form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
  status.textContent = 'Enviando…';
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 20000);
  try {
    await sendSubmission(pendingPayload,commentToken,abort.signal,participant);
    pendingPayload = null; submissionId = null;
    form.replaceChildren();
    const thanks = document.createElement('h2'); thanks.textContent = 'Obrigada por contribuir! Suas respostas foram recebidas.'; form.append(thanks);
  } catch (error) {
    status.textContent = error.message === 'NOT_ACCEPTED' ? 'O envio não foi aceito. O ciclo pode estar fechado ou indisponível. Nenhuma confirmação de recebimento foi obtida.' : 'Não foi possível confirmar o recebimento. Tente reenviar o mesmo conteúdo. Não recarregue a página; o envio anterior pode ter sido recebido.';
    // Freeze the submitted draft after an ambiguous failure so retries cannot change its content.
    const button = form.querySelector('[type="submit"]'); button.disabled = error.message === 'NOT_ACCEPTED'; button.textContent = 'Tentar reenviar';
  } finally { clearTimeout(timeout); sending = false; }
});
updateProgress();
