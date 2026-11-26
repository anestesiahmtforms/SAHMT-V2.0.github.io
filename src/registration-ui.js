import './registration-ui.css';
import {registrationField, isRegistrationList} from './registration-fields.js';
import {PROFESSIONAL_FIELDS, ATTACHMENT_SUBJECTS, OPTIONAL_TEXT_UNANSWERED, LEGACY_REQUIRED_TEXT_FIELDS, professionalTextAnswer, validateProfessionalAnswers, scheduleParticipationPercent} from './registration-domain.js';
import {prepareDocumentFile, documentBase64} from './document-image.js';
import {formatBirthDateAge} from './date-format.js';
import {watchRegistrationChanges} from './registration-refresh.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fileInput = '[data-reg-file]';
const participationFormat = new Intl.NumberFormat('pt-BR', {style:'percent', maximumFractionDigits:2});

function message(error) {
 const code = error.code || error.message;
 if (code?.startsWith('REGISTRATION_INVALID_') && code !== 'REGISTRATION_INVALID_INPUT') {
  const field = PROFESSIONAL_FIELDS.find(field => field.id.toUpperCase() === code.slice('REGISTRATION_INVALID_'.length));
  if (field) return 'Confira o campo ' + field.label + '.';
 }
 return ({
  REGISTRATION_INVALID_INPUT:'Confira os dados preenchidos, o CPF, o CRM, o telefone e a data de nascimento.',
  REGISTRATION_VERSION_CONFLICT:'Seu cadastro mudou em outra sessão. Volte e reabra para conferir a versão atual.',
  REGISTRATION_SCHEMA_CHANGED:'Reabra o cadastro para preencher a versão atual do formulário.',
  REGISTRATION_GROUP_UNAVAILABLE:'Seu vínculo institucional precisa ser conferido pelo administrador.',
  REGISTRATION_FORBIDDEN:'Seu acesso não está liberado.',
  REGISTRATION_FOLDER_DISABLED:'O Cadastro Profissional está indisponível.',
  REGDRIVE_FORBIDDEN:'O envio de comprovantes depende do vínculo institucional da conta. Solicite a conferência à administração.',
  REGDRIVE_AUTH_REQUIRED:'O armazenamento no Drive está indisponível. Solicite a verificação à administração.',
  REGDRIVE_NOT_CONFIGURED:'O armazenamento no Drive está indisponível. Solicite a verificação à administração.',
  REGDRIVE_DESTINATION_INVALID:'A pasta de destino no Drive precisa ser conferida pela administração.',
  REGDRIVE_UPLOAD_LIMIT:'O limite diário de comprovantes foi atingido.',
  REGDRIVE_UPLOAD_CONFLICT:'Esta tentativa corresponde a outro arquivo. Selecione o comprovante novamente.',
  DOCUMENT_FILE_TOO_LARGE:'O arquivo ultrapassa o limite permitido.',
  REGISTRATION_INPUT_TOO_LARGE:'O arquivo ultrapassa o limite permitido.'
 })[code] || ([401,403].includes(error.status)
  ? 'Sua sessão mudou ou o acesso não está liberado. Reabra o cadastro.'
  : 'Não foi possível confirmar a operação. Tente novamente.');
}

export function mountInstitutionalRegistration(root, {request, isCurrent = () => true} = {}) {
 const pending = new Set();
 let disposed = false, state, saving = false, uploading = false, attachment = null;
 let savedForm, afterFeedback, stopRegistrationWatch=()=>{};
 const browser = root.ownerDocument.defaultView;
 const query = selector => root.querySelector(selector);
 const live = () => !disposed && root.isConnected && isCurrent();
 root.classList.add('registration-app');

 async function call(target, action, input = {}) {
  if (!live()) throw Error('SESSION_CHANGED');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(),60000);
  pending.add(controller);
  try {
   const data = await request(target, action, input, controller.signal);
   if (!live()) throw Error('SESSION_CHANGED');
   return data;
  } finally {
   clearTimeout(deadline);
   pending.delete(controller);
  }
 }

 function notice(selector, text, alert = false) {
  const node = query(selector);
  node.textContent = text;
  node.setAttribute('role', alert ? 'alert' : 'status');
 }

 function updateAttachmentControls() {
  const subject = query('[data-reg-subject]');
  subject.disabled = uploading;
  const pickerDisabled = uploading || !subject.value;
  query('[data-reg-choose]').disabled = pickerDisabled;
  query(fileInput).disabled = pickerDisabled;
  query('[data-reg-retry]').hidden = uploading || !attachment;
 }

 function conditionals() {
  root.querySelectorAll('[data-conditional]').forEach(node => {
   const [field, value] = node.dataset.conditional.split(':');
   node.hidden = query('[name="' + field + '"]').value !== value;
  });
 }

 function updateAge(event) {
  if (event && event.target.name !== 'birthDate') return;
  const age = formatBirthDateAge(query('[name="birthDate"]').value);
  query('[data-reg-age]').hidden = !age;
  const output = query('[data-reg-age-value]');
  if (output.textContent !== age) output.textContent = age;
 }

 function updateScheduleParticipation(workDays) {
  const percent = scheduleParticipationPercent(workDays);
  query('[data-reg-schedule-participation]').textContent = percent === null
   ? 'A preencher'
   : participationFormat.format(percent / 100);
 }

 function formSnapshot(form) {
  const data = new FormData(form);
  const answers = Object.fromEntries(PROFESSIONAL_FIELDS.map(field => [field.id,
   isRegistrationList(field) ? data.getAll(field.id) : String(data.get(field.id) || '')]));
  return {answers, truth:data.get('truth') === 'on'};
 }

 function hasUnsavedChanges() {
  const form = query('.reg-form');
  return form && (saving || uploading || attachment || JSON.stringify(formSnapshot(form)) !== savedForm);
 }

 function feedback(kind, title, details, onDiscard) {
  const dialog = query('[data-reg-feedback]');
  const list = query('[data-reg-feedback-details]');
  dialog.dataset.kind = kind;
  query('#reg-feedback-title').textContent = title;
  list.hidden = details.length === 0;
  if (list.hidden) dialog.removeAttribute('aria-describedby');
  else dialog.setAttribute('aria-describedby',list.id);
  list.replaceChildren(...details.map(text => {
   const item = root.ownerDocument.createElement('li');
   item.textContent = text;
   return item;
  }));
  query('[data-reg-continue]').textContent = onDiscard ? 'Continuar editando' : 'OK';
  query('[data-reg-discard]').hidden = !onDiscard;
  afterFeedback = onDiscard;
  if (!dialog.open) dialog.showModal();
  query('[data-reg-continue]').focus();
 }

 function confirmExit(leave) {
  if (!live() || !hasUnsavedChanges()) return false;
  if (saving) {
   feedback('error', 'Envio em andamento', ['Aguarde a confirmação antes de sair.']);
  } else {
   const dirty=JSON.stringify(formSnapshot(query('.reg-form'))) !== savedForm;
   const details=[];
   if(dirty)details.push('As alterações no formulário serão descartadas.');
   if(uploading||attachment)details.push('Há um comprovante opcional com envio ainda não confirmado.');
   feedback('error', dirty?'Fechar sem salvar?':'Sair do Cadastro Profissional?', details, leave);
  }
  return true;
 }

 function beforeUnload(event) {
  if (!live() || !hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
 }

 function hashChange(event) {
  if (!confirmExit(() => { browser.location.href = event.newURL; })) return;
  event.stopImmediatePropagation();
  browser.history.replaceState(browser.history.state, '', event.oldURL);
 }

 function render() {
  const values = state.record?.answers || {};
  const formerFiliation = values.filiation || state.record?.legacyAnswers?.filiation;
  const fields = PROFESSIONAL_FIELDS.map(field => {
   const value = professionalTextAnswer(field.id,values[field.id]) ?? (field.id === 'fullName' ? state.profile?.displayName : '');
   const note = field.id === 'fatherName' && formerFiliation
     ? '<p class="reg-help reg-previous-filiation">Filiação informada anteriormente · ' + escape(formerFiliation) + '</p>'
     : '';
   return registrationField(field,value) + note;
  }).join('');
  root.innerHTML = `<div class="reg-notice" data-reg-notice role="status" aria-live="polite"></div>
   <form class="reg-form" novalidate><div class="reg-grid">${fields}</div>
   <label class="reg-confirm"><input type="checkbox" name="truth" required>Confirmo que as informações declaradas são verdadeiras e se destinam ao cadastro institucional.</label>
   <button class="primary-button" type="submit" data-reg-save>SALVAR MEU CADASTRO</button></form>
   <section class="reg-attachments"><h3>Comprovantes (opcionais)</h3>
   <label class="reg-field"><span>Assunto</span><select data-reg-subject><option value="">Selecione o assunto</option>
   ${Object.entries(ATTACHMENT_SUBJECTS).map(([id,label]) => `<option value="${id}">${escape(label)}</option>`).join('')}</select></label>
   <button class="secondary-button reg-file-picker" type="button" data-reg-choose disabled>Escolher documento/Fotografar documento</button>
   <input type="file" accept="application/pdf,image/*" data-reg-file hidden disabled>
   <p class="reg-help">PDF até 5 MB. As fotos são convertidas para JPEG, com até 1.600 pixels.</p>
   <div class="reg-notice" data-reg-file-status role="status" aria-live="polite"></div>
   <button class="secondary-button" type="button" data-reg-retry hidden>TENTAR NOVAMENTE</button>
   <div data-reg-files></div></section>
   <dialog class="reg-feedback" data-reg-feedback aria-labelledby="reg-feedback-title" aria-describedby="reg-feedback-details">
    <h3 id="reg-feedback-title"></h3>
    <ul id="reg-feedback-details" data-reg-feedback-details></ul>
    <div class="reg-feedback-actions">
     <button type="button" class="secondary-button" data-reg-continue>OK</button>
     <button type="button" class="secondary-button" data-reg-discard hidden>Sair sem salvar</button>
    </div>
   </dialog>`;
  savedForm = JSON.stringify(formSnapshot(query('.reg-form')));
  conditionals();
  updateAge();
  updateScheduleParticipation(values.workDays ?? state.record?.legacyAnswers?.workDays);
  void listFiles();
 }

 let fileListRevision = 0;
 async function listFiles() {
  const revision = ++fileListRevision;
  try {
   const {files} = await call('drive', 'LIST_OWN');
   if (revision !== fileListRevision) return;
   query('[data-reg-files]').innerHTML = files.length
    ? '<ul>' + files.map(file => '<li>' + escape(ATTACHMENT_SUBJECTS[file.subject]) + ' · ' + escape(file.name) + ' · enviado</li>').join('') + '</ul>'
    : '<p>Nenhum comprovante enviado por este cadastro.</p>';
  } catch {
   if (live() && revision === fileListRevision) query('[data-reg-files]').textContent = 'A consulta dos comprovantes está temporariamente indisponível.';
  }
 }

 async function submit(event) {
  event.preventDefault();
  if (saving || !live()) return;
  const snapshot = formSnapshot(event.target);
  const {answers, truth} = snapshot;
  const issues = PROFESSIONAL_FIELDS.filter(field => {
   if (field.when && answers[field.when[0]] !== field.when[1]) return false;
   const value = answers[field.id];
   return field.required && (Array.isArray(value) ? value.length < (field.min || 1) : !value.trim());
  }).map(field => field.label + ': preenchimento obrigatório.');
  if (!truth) issues.push('Marque a declaração de veracidade das informações.');
  if (issues.length) {
   feedback('error', 'Cadastro com pendências', issues);
   return;
  }
  saving = true;
  query('[data-reg-save]').disabled = true;
  try {
   const input = {
    expectedVersion:state.record?.version || 0,
    answers:validateProfessionalAnswers(answers),
    truth
   };
   notice('[data-reg-notice]', 'Confirmando envio…');
   let result;
   for (;;) {
    try {result=await call('professional','SAVE',input);break;}
    catch(error){
     // Older workers reject these blank fields before writing.
     const field=LEGACY_REQUIRED_TEXT_FIELDS[error.code];
     if(error.status!==400||!field||input.answers[field]!=='')throw error;
     input.answers[field]=OPTIONAL_TEXT_UNANSWERED;
    }
   }
   if (!result.record) throw Error('REGISTRATION_SAVE_UNCONFIRMED');
   state.record = result.record;
   savedForm = JSON.stringify(snapshot);
   notice('[data-reg-notice]', '');
   if (JSON.stringify(formSnapshot(event.target)) !== savedForm) {
    feedback('error', 'Cadastro com pendências', ['A versão enviada foi salva. Ainda há alterações pendentes no formulário.']);
   } else {
    feedback('success', 'Cadastro salvo com sucesso.', []);
   }
  } catch (error) {
   if (live()) {
    notice('[data-reg-notice]', '');
    feedback('error', 'Cadastro com pendências', [message(error)]);
   }
  } finally {
   saving = false;
   if (live()) query('[data-reg-save]').disabled = false;
  }
 }

 async function upload() {
  if (uploading || !attachment || !live()) return;
  uploading = true;
  updateAttachmentControls();
  try {
   const attempt = attachment;
   const {file, subject, requestId} = attempt;
   if (!attempt.payload) {
    notice('[data-reg-file-status]', 'Preparando comprovante…');
    try {
     const {blob, mimeType} = await prepareDocumentFile(file);
     attempt.payload = {requestId, subject, mimeType, dataBase64:await documentBase64(blob)};
    } catch (error) {
     attachment = null;
     if (live()) {
      const reason = error instanceof DOMException ? 'Não foi possível ler o arquivo. Selecione-o novamente.' : error.message;
      notice('[data-reg-file-status]', reason, true);
     }
     return;
    }
   }
   if (!live()) return;
   notice('[data-reg-file-status]', 'Enviando comprovante ao Drive…');
   const result = await call('drive', 'UPLOAD', attempt.payload);
   if (result.file?.status !== 'STORED') throw Error('REGDRIVE_UNCONFIRMED');
   attachment = null;
   notice('[data-reg-file-status]', 'Comprovante arquivado no Drive na pasta correspondente.');
   void listFiles();
  } catch (error) {
   if (live()) notice('[data-reg-file-status]', message(error), true);
  } finally {
   uploading = false;
   if (live()) {
    query(fileInput).value = '';
    updateAttachmentControls();
   }
  }
 }

 function change(event) {
  const target = event.target;
  updateAge(event);
  conditionals();
  if (target.name === 'workDays' && target.type === 'checkbox') {
   const [day, option] = target.value.split(':');
   if (target.checked && (option === 'WEEKLY' || option === 'FORTNIGHTLY')) {
    const other = option === 'WEEKLY' ? 'FORTNIGHTLY' : 'WEEKLY';
    const otherInput = query('input[type="checkbox"][name="workDays"][value="' + day + ':' + other + '"]');
    if (otherInput) otherInput.checked = false;
   }
   const workDays = Array.from(root.querySelectorAll('[name="workDays"]:checked'), input => input.value);
   updateScheduleParticipation(workDays);
  }
  const field = PROFESSIONAL_FIELDS.find(field => field.id === target.name);
  if (field?.none && target.checked) {
   for (const option of root.querySelectorAll('[name="' + field.id + '"]')) {
    if (option !== target && (target.value === field.none || option.value === field.none)) option.checked = false;
   }
  }
  if (target.matches('[data-reg-subject]')) {
   attachment = null;
   notice('[data-reg-file-status]', '');
   updateAttachmentControls();
  }
  if (target.matches(fileInput) && target.files?.length && !uploading && query('[data-reg-subject]').value) {
   attachment = {file:target.files[0], subject:query('[data-reg-subject]').value, requestId:crypto.randomUUID()};
   void upload();
  }
 }

 const click = event => {
  if (event.target.closest('[data-reg-continue]')) query('[data-reg-feedback]').close();
  if (event.target.closest('[data-reg-discard]')) {
   const leave = afterFeedback;
   query('[data-reg-feedback]').close();
   savedForm = JSON.stringify(formSnapshot(query('.reg-form')));
   attachment = null;
   leave?.();
  }
  if (event.target.closest('[data-reg-choose]')) query(fileInput).click();
  if (event.target.closest('[data-reg-retry]')) void upload();
 };
 browser.addEventListener('beforeunload', beforeUnload);
 browser.addEventListener('hashchange', hashChange, true);
 root.addEventListener('submit', submit);
 root.addEventListener('input', updateAge);
 root.addEventListener('change', change);
 root.addEventListener('click', click);
 root.innerHTML = '<p role="status">Preparando cadastro…</p>';
 void call('professional', 'BOOTSTRAP').then(data => {
  if (!live()) return;
  state = data;
  render();
  stopRegistrationWatch = watchRegistrationChanges(async () => {
   if (hasUnsavedChanges() || query('[data-reg-feedback]').open) return;
   const updated = await call('professional', 'BOOTSTRAP');
   if (hasUnsavedChanges() || query('[data-reg-feedback]').open) return;
   if (updated.record?.version > (state.record?.version || 0)) {
    state = updated;
    render();
   } else await listFiles();
  }, {isCurrent:live,document:root.ownerDocument});
 }).catch(error => {
  if (live()) root.innerHTML = '<p role="alert">' + escape(message(error)) + '</p>';
 });

 const cleanup = () => {
  disposed = true;
  stopRegistrationWatch();
  for (const controller of pending) controller.abort();
  pending.clear();
  attachment = null;
  state = null;
  browser.removeEventListener('beforeunload', beforeUnload);
  browser.removeEventListener('hashchange', hashChange, true);
  root.removeEventListener('submit', submit);
  root.removeEventListener('input', updateAge);
  root.removeEventListener('change', change);
  root.removeEventListener('click', click);
  root.replaceChildren();
  root.classList.remove('registration-app');
 };
 cleanup.goBack = confirmExit;
 return cleanup;
}
