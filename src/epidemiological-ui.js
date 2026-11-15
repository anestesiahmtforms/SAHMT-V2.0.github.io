import './registration-ui.css';
import {registrationField} from './registration-fields.js';
import {EPIDEMIOLOGICAL_FIELDS,REGISTRATION_CYCLE,validateCompleteEpidemiologicalSubmission,bmiBand} from './registration-domain.js';
import {mountSurveyFlow,surveyResponseId} from './survey-flow.js';

const questions = EPIDEMIOLOGICAL_FIELDS.map(field => registrationField({...field,required:true})).join('') +
  '<details class="reg-bmi"><summary>Calcular a faixa de IMC (opcional)</summary><p>Somente a faixa escolhida é enviada.</p><label>Peso em kg<input type="number" inputmode="decimal" data-local-weight></label><label>Altura em cm<input type="number" inputmode="decimal" data-local-height></label><output data-local-bmi></output></details>' +
  '<label class="reg-field">Sugestão para um modelo de trabalho mais saudável<textarea name="comments" rows="3" maxlength="1500" required></textarea><small>Evite nomes e detalhes identificáveis. Se não tiver sugestão, escreva “Sem sugestão”.</small></label>';

export function mountEpidemiologicalSurvey(root,{request,onComplete}) {
  const controller = new AbortController();
  root.classList.add('registration-app');
  mountSurveyFlow(root,{
    title:'Cadastro Epidemiológico - SAHMT',
    questions,
    privacy:'<p>As respostas são registradas somente pelo grupo. Nome, e-mail, UID e IP não fazem parte dos dados de respostas. O controle de participação fica separado para impedir duplicidades. A infraestrutura pode gerar registros técnicos e não há garantia de anonimato absoluto.</p><p>Não informe nomes ou detalhes que possam identificar você ou outras pessoas. Os resultados serão agrupados, com proteção de grupos pequenos.</p>',
    async identify() {
      const state = await request('BOOTSTRAP',{},controller.signal);
      if (state.group !== 'team') throw Error('SURVEY_GROUP_UNAVAILABLE');
      return state;
    },
    readResponse(data,form) {
      const answers = Object.fromEntries(EPIDEMIOLOGICAL_FIELDS.map(field => [
        field.id,field.type === 'checks' ? data.getAll(field.id) : data.get(field.id)
      ]));
      const unanswered = EPIDEMIOLOGICAL_FIELDS.find(field => field.type === 'checks' && !answers[field.id].length);
      if (unanswered) {
        form.elements.namedItem(unanswered.id)[0].focus();
        throw Error('Selecione ao menos uma opção para “'+unanswered.label+'”.');
      }
      return validateCompleteEpidemiologicalSubmission({
        survey_cycle:REGISTRATION_CYCLE,survey_version:'1.0',submission_id:surveyResponseId(),group:'team',consent:true,
        answers,comments:data.get('comments')
      });
    },
    submit:(payload,signal)=>request('SUBMIT',payload,AbortSignal.any([controller.signal,signal])),
    onComplete
  });
  root.addEventListener('change',event=>{
    const field = EPIDEMIOLOGICAL_FIELDS.find(field=>field.type==='checks'&&field.id===event.target.name);
    if (!field || !event.target.checked) return;
    const exclusive = [field.none,'UNKNOWN'];
    const controls = root.querySelectorAll('[name="'+field.id+'"]');
    for (const control of controls) {
      if (control!==event.target&&(exclusive.includes(control.value)||exclusive.includes(event.target.value))) control.checked=false;
    }
  });
  root.addEventListener('input',event=>{
    if (!event.target.matches('[data-local-weight],[data-local-height]')) return;
    const result = bmiBand(root.querySelector('[data-local-weight]').value,root.querySelector('[data-local-height]').value);
    root.querySelector('[data-local-bmi]').textContent = result ? 'IMC calculado: '+String(result.value).replace('.',',') : 'Informe peso e altura nas unidades indicadas.';
    if (result) root.querySelector('[name=bmiBand]').value=result.band;
  });
  return ()=>{controller.abort();root.replaceChildren();};
}
