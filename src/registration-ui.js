import './registration-ui.css';
import {registrationField, isRegistrationList} from './registration-fields.js';
import {PROFESSIONAL_FIELDS, ATTACHMENT_SUBJECTS, validateProfessionalAnswers} from './registration-domain.js';
import {prepareDocumentFile, documentBase64} from './document-image.js';
import {isValidDateKey, localDateKey} from './schedule-date.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fileInput = '[data-reg-file]';

function formatBirthDateAge(birthDate, today) {
 if (birthDate < '1900-01-01' || birthDate > today || !isValidDateKey(birthDate)) return '';
 const [birthYear,birthMonth,birthDay] = birthDate.split('-').map(Number);
 const [year,month,day] = today.split('-').map(Number);
 // In a shorter month the anniversary falls on its last day.
 const anniversaryDay = month => Math.min(birthDay,new Date(Date.UTC(year,month,0)).getUTCDate());
 const anchorMonth = anniversaryDay(month) <= day ? month : month - 1;
 const elapsedMonths = (year - birthYear) * 12 + anchorMonth - birthMonth;
 const elapsedDays = (Date.UTC(year,month-1,day) - Date.UTC(year,anchorMonth-1,anniversaryDay(anchorMonth))) / 86_400_000;
 const years = Math.floor(elapsedMonths / 12), months = elapsedMonths % 12;
 return `${years} ${years === 1 ? 'ano' : 'anos'}, ${months} ${months === 1 ? 'mês' : 'meses'} e ${elapsedDays} ${elapsedDays === 1 ? 'dia' : 'dias'}`;
}

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
  REGISTRATION_FOLDER_DISABLED:'O Cadastro Profissional está desativado para este perfil. Solicite a liberação à administração.',
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
  const age = formatBirthDateAge(query('[name="birthDate"]').value,localDateKey());
  query('[data-reg-age]').hidden = !age;
  const output = query('[data-reg-age-value]');
  if (output.textContent !== age) output.textContent = age;
 }

 function render() {
  const values = state.record?.answers || {};
  root.innerHTML = `<div class="reg-notice" data-reg-notice role="status" aria-live="polite"></div>
   <form class="reg-form"><div class="reg-grid">${PROFESSIONAL_FIELDS.map(field => registrationField(field,
    values[field.id] ?? (field.id === 'fullName' ? state.profile?.displayName : ''))).join('')}</div>
   <label class="reg-confirm"><input type="checkbox" name="truth" required>Confirmo que as informações declaradas são verdadeiras e se destinam ao cadastro institucional.</label>
   <button class="primary-button" type="submit" data-reg-save>SALVAR MEU CADASTRO</button></form>
   <section class="reg-attachments"><h3>Comprovantes</h3>
   <label class="reg-field"><span>Assunto</span><select data-reg-subject><option value="">Selecione o assunto</option>
   ${Object.entries(ATTACHMENT_SUBJECTS).map(([id,label]) => `<option value="${id}">${escape(label)}</option>`).join('')}</select></label>
   <button class="secondary-button reg-file-picker" type="button" data-reg-choose disabled>Escolher documento/Fotografar documento</button>
   <input type="file" accept="application/pdf,image/*" data-reg-file hidden disabled>
   <p class="reg-help">PDF até 5 MB. As fotos são convertidas para JPEG, com até 1.600 pixels.</p>
   <div class="reg-notice" data-reg-file-status role="status" aria-live="polite"></div>
   <button class="secondary-button" type="button" data-reg-retry hidden>TENTAR NOVAMENTE</button>
   <div data-reg-files></div></section>`;
  conditionals();
  updateAge();
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
  const form = new FormData(event.target);
  saving = true;
  query('[data-reg-save]').disabled = true;
  try {
   const answers = Object.fromEntries(PROFESSIONAL_FIELDS.map(field => [field.id,
    isRegistrationList(field) ? form.getAll(field.id) : String(form.get(field.id) || '')]));
   const input = {
    expectedVersion:state.record?.version || 0,
    answers:validateProfessionalAnswers(answers),
    truth:form.get('truth') === 'on'
   };
   notice('[data-reg-notice]', 'Confirmando envio…');
   const result = await call('professional', 'SAVE', input);
   state.record = result.record;
   notice('[data-reg-notice]', 'Cadastro salvo com sucesso.');
  } catch (error) {
   if (live()) {
    notice('[data-reg-notice]', message(error), true);
    const field = PROFESSIONAL_FIELDS.find(field => error.code === 'REGISTRATION_INVALID_' + field.id.toUpperCase());
    if (field) {
     const group = query('[data-field="' + field.id + '"]');
     const details = group?.querySelector('details');
     if (details) details.open = true;
     group?.querySelector('input,select,textarea')?.focus();
    }
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
  if (event.target.closest('[data-reg-choose]')) query(fileInput).click();
  if (event.target.closest('[data-reg-retry]')) void upload();
 };
 root.addEventListener('submit', submit);
 root.addEventListener('input', updateAge);
 root.addEventListener('change', change);
 root.addEventListener('click', click);
 root.innerHTML = '<p role="status">Preparando cadastro…</p>';
 void call('professional', 'BOOTSTRAP').then(data => {
  state = data;
  if (live()) render();
 }).catch(error => {
  if (live()) root.innerHTML = '<p role="alert">' + escape(message(error)) + '</p>';
 });

 return () => {
  disposed = true;
  for (const controller of pending) controller.abort();
  pending.clear();
  attachment = null;
  state = null;
  root.removeEventListener('submit', submit);
  root.removeEventListener('input', updateAge);
  root.removeEventListener('change', change);
  root.removeEventListener('click', click);
  root.replaceChildren();
  root.classList.remove('registration-app');
 };
}
