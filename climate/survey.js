import {COMMON, DIMENSIONS, MODULES, OPEN, VERSION, CYCLE, groupForModule} from '../climate-domain/schema.js';
import './style.css';
import {sendSubmission} from './transport.js';
const app = document.querySelector('#app');
const options = [['1', 'Discordo totalmente'], ['2', 'Discordo'], ['3', 'Nem concordo nem discordo'], ['4', 'Concordo'], ['5', 'Concordo totalmente'], ['NA', 'Não se aplica / não tenho informação']];
const renderQuestion = q => `<fieldset><legend>${q.id}. ${q.text}</legend><div class="options">${options.map(([value, label]) => `<label><input type="radio" name="${q.id}" value="${value}"><span>${value === 'NA' ? 'N/A' : value} · ${label}</span></label>`).join('')}</div><button type="button" class="clear" data-clear="${q.id}">Limpar resposta</button></fieldset>`;
app.innerHTML = `<header><p class="eyebrow">SAHMT · ENQUETES E CONSULTAS</p><h1>Pesquisa de clima organizacional</h1><p>Ciclo ${CYCLE} · últimos 6 meses · 8–12 minutos</p></header>
<section class="notice"><h2>Antes de começar</h2><p>Participação voluntária. As respostas não serão utilizadas para avaliação de desempenho. O formulário não solicita nome, e-mail, matrícula ou login. Não inclua dados de pessoas ou pacientes nos comentários.</p><p>Divulgaremos apenas resultados agregados após o encerramento. Grupos pequenos serão protegidos e a equipe administrativa não terá resultados isolados. Comentários precisam de revisão e desidentificação antes de qualquer compartilhamento.</p><p>O serviço de hospedagem e a infraestrutura podem produzir registros técnicos, incluindo IP. O código da pesquisa não os inclui nas respostas, mas não podemos prometer anonimato absoluto. Metadados técnicos de gravação podem permitir que administradores relacionem comentários e respostas. Esta página não usa rastreadores ou armazenamento local de respostas. Ao sair ou recarregar, o rascunho será perdido.</p><p>Este é um instrumento institucional autoral, inspirado em temas de qualidade e segurança; não é um questionário oficial ou validado pela Accreditation Canada.</p></section>
<form><label class="consent"><input type="checkbox" name="consent" required> Li as informações e concordo em participar voluntariamente.</label>
<label class="profile">Grupo e atividade (opcional)<select name="module"><option value="none">Prefiro não informar</option><option value="resident">Residentes</option><option value="preceptor">Equipe — anestesiologista/preceptor</option><option value="clinical">Equipe — anestesiologista sem preceptoria</option><option value="administrative">Secretárias</option></select></label><p>Será salvo apenas o grupo escolhido: residentes, secretárias ou equipe. A escolha também seleciona perguntas adicionais. Você pode preferir não informar. Como há duas secretárias, seus resultados numéricos não serão divulgados separadamente. Não haverá total de pontuações que permita deduzi-los por subtração.</p>
<p>Você pode deixar itens em branco ou marcar N/A. Para enviar, responda pelo menos um item comum de 1 a 5.</p><p id="progress" role="status"></p>
${DIMENSIONS.map(([label], i) => `<section><h2>${i + 1}. ${label}</h2>${COMMON.slice(i * 4, i * 4 + 4).map(renderQuestion).join('')}</section>`).join('')}
<section id="module" hidden></section><section><h2>Comentários opcionais</h2><p>Evite nomes, datas exatas, casos clínicos ou detalhes que identifiquem você ou outras pessoas. Não use este formulário para urgências ou notificações assistenciais.</p>${OPEN.map(q => `<label class="open">${q.id}. ${q.text}<textarea name="${q.id}" maxlength="1500" rows="3"></textarea></label>`).join('')}</section>
<p>O link não exige login. Isso limita o controle de duplicidades; pedimos apenas um envio por pessoa. Um reenvio após falha nesta mesma página usa o mesmo código aleatório.</p><button type="submit" class="primary">Enviar respostas</button><p id="status" role="status" aria-live="polite"></p></form>`;
const form = app.querySelector('form'), status = app.querySelector('#status');
// No UID, cookies, authentication token, referrer, analytics SDK, or persistent draft.
let submissionId = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
const commentToken = [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
let pendingPayload = null, sending = false;
function updateProgress() {
  app.querySelector('#progress').textContent = `${COMMON.filter(q => form.querySelector(`input[name="${q.id}"]:checked`)).length} de 32 itens comuns respondidos.`;
}
form.elements.module.addEventListener('change', () => {
  const qs = MODULES[form.elements.module.value], host = app.querySelector('#module');
  host.hidden = !qs;
  host.innerHTML = qs ? `<h2>Perguntas para sua função</h2>${form.elements.module.value === 'administrative' ? '<p>Este módulo não terá resultados exclusivos divulgados.</p>' : ''}${qs.map(renderQuestion).join('')}` : '';
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
    for (const q of [...COMMON, ...(MODULES[data.get('module')] || [])]) {
      const value = data.get(q.id);
      if (value) answers[q.id] = value === 'NA' ? 'NA' : Number(value);
    }
    if (!COMMON.some(q => Number.isInteger(answers[q.id]))) { status.textContent = 'Responda pelo menos um item comum de 1 a 5.'; return; }
    for (const q of OPEN) if (data.get(q.id)?.trim()) comments[q.id] = data.get(q.id).trim();
    pendingPayload = {survey_version: VERSION, survey_cycle: CYCLE, submission_id: submissionId, consent: true, answers, comments, group: groupForModule(data.get('module'))};
  }
  sending = true;
  form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
  status.textContent = 'Enviando…';
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 20000);
  try {
    await sendSubmission(pendingPayload,commentToken,abort.signal);
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
