import './registration-ui.css';
import {registrationField} from './registration-fields.js';
import {EPIDEMIOLOGICAL_FIELDS,REGISTRATION_CYCLE,validateCompleteEpidemiologicalSubmission,bmiBand} from './registration-domain.js';
import {mountSurveyFlow,surveyResponseId} from '../climate/survey-flow.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    extraIntro:'<div data-epi-report hidden><button type="button" class="secondary-button" data-reg-report>Indicadores Epidemiológicos</button><div data-epi-report-body role="status"></div></div>',
    async identify() {
      const state = await request('BOOTSTRAP',{},controller.signal);
      if (state.group !== 'team') throw Error('SURVEY_GROUP_UNAVAILABLE');
      if (!controller.signal.aborted && state.canReadReport) root.querySelector('[data-epi-report]').hidden = false;
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
  const reportButton = root.querySelector('[data-reg-report]');
  reportButton.addEventListener('click',async()=>{
    const area = root.querySelector('[data-epi-report-body]');
    reportButton.disabled = true;
    try {
      const {report} = await request('REPORT',{},controller.signal);
      if (controller.signal.aborted) return;
      area.innerHTML='<h3>Indicadores epidemiológicos</h3>'+(report?Object.entries(report.groups||{}).filter(([key])=>['team','resident'].includes(key)).map(([,g])=>'<section><h4>'+h(g.label)+'</h4>'+(g.suppressed?'<p>Grupo protegido: menos de cinco respostas.</p>':'<p>'+h(g.respondents)+' participantes</p>'+g.questions.map(q=>'<section class="reg-metric"><h5>'+h(q.label)+'</h5>'+(q.suppressed?'<p>Distribuição protegida para impedir identificação de grupos pequenos.</p>':q.options.map(o=>'<div class="reg-bar"><span>'+h(o.label)+'</span><progress max="100" value="'+Number(o.percent)+'"></progress><b>'+h(o.percent)+'%</b></div>').join(''))+'</section>').join(''))+'</section>').join(''):'<p>Os indicadores serão disponibilizados após o encerramento e a publicação do ciclo, com proteção de grupos pequenos.</p>');
    } catch {
      if (!controller.signal.aborted) area.textContent='Não foi possível carregar os indicadores. Tente novamente.';
    } finally {
      reportButton.disabled = false;
    }
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
