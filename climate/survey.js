import {mountSurveyFlow,surveyResponseId} from '../src/survey-flow.js';
import {identifyInstitutionalGroup} from './participant-group.js';
import {COMMON,DIMENSIONS,OPEN,VERSION,CYCLE,questionsForSelection} from '../climate-domain/schema.js';
import './style.css';
import {sendSubmission} from './transport.js';

const options = [['1', 'Discordo totalmente'], ['2', 'Discordo'], ['3', 'Nem concordo nem discordo'], ['4', 'Concordo'], ['5', 'Concordo totalmente'], ['NA', 'Não se aplica / não tenho informação']];
const renderQuestion = q => `<fieldset><legend>${q.id}. ${q.text}</legend><div class="options">${options.map(([value,label]) => `<label><input type="radio" name="${q.id}" value="${value}" required><span>${value === 'NA' ? 'N/A' : value} · ${label}</span></label>`).join('')}</div></fieldset>`;
let participantGroup;
const commentToken = surveyResponseId();

mountSurveyFlow(document.querySelector('#app'), {
  identify:identifyInstitutionalGroup,
  title: 'Pesquisa de clima organizacional',
  questions: `<p>Considere os últimos seis meses. Marque N/A quando o item não se aplicar ou quando você não tiver informação para responder.</p>
    ${DIMENSIONS.map(([label], i) => `<section><h2>${i + 1}. ${label}</h2>${COMMON.slice(i * 4, i * 4 + 4).map(renderQuestion).join('')}</section>`).join('')}
    <section id="module"></section>
    <section><h2>Comentários</h2><p>Evite nomes, datas exatas, casos clínicos e outros detalhes que possam identificar pessoas. Se não tiver contribuição para um campo, escreva “Sem sugestão”.</p>
    ${OPEN.map(q => `<label class="open">${q.id}. ${q.text}<textarea name="${q.id}" maxlength="1500" rows="3" required></textarea></label>`).join('')}</section>`,
  onGroup(group, form) {
    participantGroup = group;
    form.querySelector('#module').innerHTML = '<h2>Perguntas para sua função</h2>' + questionsForSelection(group).map(renderQuestion).join('');
  },
  readResponse(data) {
    const answers = Object.fromEntries([...COMMON,...questionsForSelection(participantGroup)].map(q => {
      const value = data.get(q.id);
      return [q.id, value === 'NA' ? 'NA' : Number(value)];
    }));
    if (!COMMON.some(q => Number.isInteger(answers[q.id]))) throw Error('Use a escala de 1 a 5 em pelo menos uma pergunta comum.');
    const comments = Object.fromEntries(OPEN.map(q => [q.id, data.get(q.id).trim()]));
    return {survey_version:VERSION,survey_cycle:CYCLE,submission_id:surveyResponseId(),consent:true,answers,comments,group:participantGroup};
  },
  submit(payload, signal) { return sendSubmission(payload, commentToken, signal); }
});