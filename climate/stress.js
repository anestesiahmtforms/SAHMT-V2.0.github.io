import {mountSurveyFlow,surveyResponseId} from '../src/survey-flow.js';
import {identifyInstitutionalGroup} from './participant-group.js';
import './style.css';
import {DIMENSIONS,QUESTIONS,SCALE,VERSION,CYCLE} from '../stress-domain/schema.js';
import {send} from './stress-transport.js';

let participantGroup;
mountSurveyFlow(document.querySelector('#app'), {
  identify:identifyInstitutionalGroup,
  title: 'Avaliação de estresse e fadiga',
  questions: `<p>Considere os últimos sete dias e escolha a frequência de cada experiência.</p>
    ${DIMENSIONS.map(d => `<section><h2>${d.label}</h2>${QUESTIONS.filter(q => q.dimension === d.id).map(q => `<fieldset><legend>${q.id}. ${q.text}</legend><div class="options">${SCALE.map(([value,label]) => `<label><input type="radio" name="${q.id}" value="${value}" required><span>${value} · ${label}</span></label>`).join('')}</div></fieldset>`).join('')}</section>`).join('')}
    <section><h2>Estresse percebido</h2><label>Nos últimos sete dias, quão intenso foi o estresse relacionado ao trabalho?
    <select name="stress_rating" required><option value="">Selecione uma opção</option>${Array.from({length:11},(_,i) => `<option value="${i}">${i}${i===0?' — nenhum estresse':i===10?' — intensidade máxima':''}</option>`).join('')}</select></label>
    <p>Essa medida de 0 a 10 é apresentada separadamente e não altera a pontuação de fadiga.</p></section>`,
  onGroup(group) { participantGroup = group; },
  readResponse(data) {
    const answers = Object.fromEntries(QUESTIONS.map(q => [q.id,Number(data.get(q.id))]));
    return {survey_cycle:CYCLE,survey_version:VERSION,submission_id:surveyResponseId(),group:participantGroup,answers,stress_rating:Number(data.get('stress_rating'))};
  },
  submit: send
});