import {mountParticipantGate} from './participant-group.js';
import {INSTITUTIONAL_SURVEYS_URL, notifySurveyHost} from '../src/survey-session-bridge.js';
import './survey-flow.css';

export function mountSurveyFlow(app, {title, questions, onGroup, readResponse, submit}) {
  const embedded = window.parent !== window;
  if (embedded) {
    document.documentElement.classList.add('survey-embedded');
    notifySurveyHost('intro');
  }
  app.classList.add('survey-app');
  app.innerHTML = `
    <section class="survey-banner" aria-labelledby="survey-title">
      <h1 id="survey-title">${title}</h1>
      <div id="participant-gate"></div>
      <div data-consent hidden>
        <label class="consent"><input type="checkbox" name="consent"> Li as informações e concordo em participar voluntariamente.</label>
        <button class="primary" type="button" data-start disabled>Iniciar Pesquisa</button>
      </div>
      ${embedded ? '' : `<footer class="survey-footer"><a href="${INSTITUTIONAL_SURVEYS_URL}">Voltar</a></footer>`}
    </section>
    <dialog class="survey-questions" aria-labelledby="questions-title">
      <form>
        <header><h2 id="questions-title" tabindex="-1">${title}</h2></header>
        <div class="survey-question-body">${questions}</div>
        <footer class="survey-footer">
          <p data-status role="status"></p>
          <div class="survey-actions">
            <button type="button" data-close>Voltar</button>
            <button type="submit" class="primary">Enviar resposta</button>
          </div>
        </footer>
      </form>
    </dialog>`;
  const gate = app.querySelector('#participant-gate');
  const consentPanel = app.querySelector('[data-consent]');
  const consent = app.querySelector('[name=consent]');
  const start = app.querySelector('[data-start]');
  const dialog = app.querySelector('dialog');
  const form = dialog.querySelector('form');
  const status = form.querySelector('[data-status]');
  const close = form.querySelector('[data-close]');
  const send = form.querySelector('[type=submit]');
  let pendingResponse, sending = false, completed = false;

  mountParticipantGate(gate, consentPanel, group => onGroup?.(group, form));
  consent.addEventListener('change', () => { start.disabled = !consent.checked; });
  start.addEventListener('click', () => {
    if (!consent.checked || completed) return;
    dialog.showModal();
    notifySurveyHost('questions');
    dialog.querySelector('h2').focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (sending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (completed) return;
    notifySurveyHost('intro');
    start.focus();
  });
  form.addEventListener('invalid', () => {
    status.textContent = 'Responda a todas as perguntas antes de enviar.';
  }, true);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!consent.checked || sending || completed) return;
    if (!pendingResponse) {
      const blank = [...form.querySelectorAll('textarea[required]')].find(field => !field.value.trim());
      if (blank) {
        status.textContent = 'Preencha o campo em destaque antes de enviar.';
        blank.focus();
        return;
      }
      try {
        pendingResponse = readResponse(new FormData(form));
      } catch (error) {
        status.textContent = error.message;
        return;
      }
      form.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = true; });
    }
    sending = send.disabled = close.disabled = true;
    status.textContent = 'Enviando…';
    try {
      const receipt = await submit(pendingResponse, AbortSignal.timeout(25000));
      if (receipt?.accepted !== true) throw Error('NOT_ACCEPTED');
      completed = true;
      status.textContent = receipt.alreadyResponded ? 'Sua participação já estava registrada.' : 'Resposta recebida. Obrigado pela participação!';
      if (embedded) notifySurveyHost('complete');
      else window.location.replace(INSTITUTIONAL_SURVEYS_URL);
    } catch (error) {
      const rejected = error.message === 'NOT_ACCEPTED';
      status.textContent = rejected ? 'O envio não foi aceito. Volte às pesquisas e tente novamente.' : 'Ainda não foi possível confirmar o envio. Tente reenviar as mesmas respostas.';
      send.disabled = rejected;
      send.textContent = 'Tentar reenviar';
    } finally {
      close.disabled = false;
      sending = false;
    }
  });
}

export function surveyResponseId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
}