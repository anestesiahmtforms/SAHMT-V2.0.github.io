import './registration-ui.css';
import {registrationField} from './registration-fields.js';
import {EPIDEMIOLOGICAL_FIELDS,REGISTRATION_CYCLE,validateCompleteEpidemiologicalSubmission,bmiBand} from './registration-domain.js';
import {mountSurveyFlow,surveyResponseId} from './survey-flow.js';

const bmiCalculator = `<details class="reg-bmi">
  <summary><span>Calcular faixa de IMC</span> <small data-bmi-status>Obrigatório</small></summary>
  <div class="reg-bmi-content">
    <p>Somente a faixa calculada é enviada.</p>
    <label>Peso em kg<input type="number" inputmode="decimal" min="10" max="500" step="any" data-local-weight required></label>
    <label>Altura em cm<input type="number" inputmode="decimal" min="50" max="250" step="any" data-local-height required></label>
    <output data-local-bmi aria-live="polite"></output>
  </div>
</details>`;
const questions = EPIDEMIOLOGICAL_FIELDS.map(field =>
  field.id === 'bmiBand' ? bmiCalculator : registrationField({...field,required:true})).join('') +
  '<label class="reg-field">Sugestão para um modelo de trabalho mais saudável<textarea name="comments" rows="3" maxlength="1500"></textarea><small>Opcional. Evite nomes e detalhes identificáveis.</small></label>';

const bmiInputs = '[data-local-weight],[data-local-height]';
function calculateBmi(container) {
  return bmiBand(container.querySelector('[data-local-weight]').value,container.querySelector('[data-local-height]').value);
}

export function mountEpidemiologicalSurvey(root,{request,onComplete}) {
  const controller = new AbortController();
  let group;
  root.classList.add('registration-app');
  mountSurveyFlow(root,{
    title:'Cadastro Epidemiológico - SAHMT',
    questions,
    privacy:'<p>As respostas são registradas somente pelo grupo. Nome, e-mail, UID e IP não fazem parte dos dados de respostas. O controle de participação fica separado para impedir duplicidades. A infraestrutura pode gerar registros técnicos e não há garantia de anonimato absoluto.</p><p>Não informe nomes ou detalhes que possam identificar você ou outras pessoas. Os resultados serão agrupados, com proteção de grupos pequenos.</p>',
    identify:()=>request('BOOTSTRAP',{},controller.signal),
    onGroup:confirmedGroup=>{group=confirmedGroup;},
    readResponse(data,form) {
      const bmi = calculateBmi(form);
      if (!bmi) {
        const calculator = form.querySelector('.reg-bmi');
        calculator.open = true;
        calculator.querySelector('input:invalid')?.focus();
        throw Error('Calcule a faixa de IMC para continuar.');
      }
      const answers = Object.fromEntries(EPIDEMIOLOGICAL_FIELDS.map(field => [
        field.id,field.id === 'bmiBand' ? bmi.band : field.type === 'checks' ? data.getAll(field.id) : data.get(field.id)
      ]));
      const unanswered = EPIDEMIOLOGICAL_FIELDS.find(field => field.type === 'checks' && !answers[field.id].length);
      if (unanswered) {
        form.elements.namedItem(unanswered.id)[0].focus();
        throw Error('Selecione ao menos uma opção para “'+unanswered.label+'”.');
      }
      return validateCompleteEpidemiologicalSubmission({
        survey_cycle:REGISTRATION_CYCLE,survey_version:'1.0',submission_id:surveyResponseId(),group,consent:true,
        answers,comments:data.get('comments')
      });
    },
    submit:(payload,signal)=>request('SUBMIT',payload,AbortSignal.any([controller.signal,signal])),
    onComplete
  });
  const {signal} = controller;
  root.addEventListener('invalid',event=>{
    if (event.target.matches(bmiInputs)) event.target.closest('.reg-bmi').open = true;
  },{capture:true,signal});
  root.addEventListener('change',event=>{
    const field = EPIDEMIOLOGICAL_FIELDS.find(field=>field.type==='checks'&&field.id===event.target.name);
    if (!field || !event.target.checked) return;
    const exclusive = [field.none,'UNKNOWN'];
    const controls = root.querySelectorAll('[name="'+field.id+'"]');
    for (const control of controls) {
      if (control!==event.target&&(exclusive.includes(control.value)||exclusive.includes(event.target.value))) control.checked=false;
    }
  },{signal});
  function updateBmi(event) {
    if (!event.target.matches(bmiInputs)) return;
    const result = calculateBmi(root);
    root.querySelector('[data-local-bmi]').textContent = result ? 'IMC calculado · '+String(result.value).replace('.',',') : '';
    root.querySelector('[data-bmi-status]').textContent = result ? 'Calculado' : 'Obrigatório';
  }
  root.addEventListener('input',updateBmi,{signal});
  root.addEventListener('change',updateBmi,{signal});
  return ()=>{controller.abort();root.replaceChildren();};
}
