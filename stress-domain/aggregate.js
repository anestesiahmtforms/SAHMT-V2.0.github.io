import {validateSubmission,calculate,DIMENSIONS,GROUPS,VERSION,CYCLE} from './schema.js';
export const MIN_GROUP=5;
const rounded=n=>Math.round(n*10)/10;
function stressMean(rows){const values=rows.map(r=>r.stress_rating).filter(Number.isInteger),missing=rows.length-values.length;return values.length>=MIN_GROUP&&(missing===0||missing>=MIN_GROUP)?{mean:rounded(values.reduce((a,b)=>a+b,0)/values.length),respondents:values.length}:null;}
function means(rows){const scores=rows.map(r=>calculate(r.answers));return {respondents:rows.length,meanScore:rounded(scores.reduce((sum,s)=>sum+s.total,0)/rows.length),dimensions:DIMENSIONS.map(d=>({id:d.id,label:d.label,mean:rounded(scores.reduce((sum,s)=>sum+s.dimensions.find(x=>x.id===d.id).score,0)/rows.length),maximum:50})),perceivedStress:stressMean(rows)};}
function opportunities(overall){
 const actions={physical:'Revisar escalas, recuperação entre jornadas, cobertura para pausas e condições de descanso.',mental:'Reduzir interrupções e tarefas simultâneas; revisar passagem de informações e canais de apoio sem punição.',symptoms:'Oferecer avaliação ocupacional confidencial e revisar ergonomia, condições ambientais e acesso a cuidados.'};
 const selected=overall.dimensions.filter(d=>d.mean/d.maximum>=0.4).sort((a,b)=>b.mean-a.mean).map(d=>({dimension:d.label,evidence:`Média agregada ${d.mean}/${d.maximum}`,action:actions[d.id],followUp:'Definir responsável e prazo; acompanhar adesão às mudanças e repetir a avaliação em novo ciclo.'}));
 return selected.length?selected:[{dimension:'Prevenção',evidence:'Sem dimensão acima do limiar gerencial de 40% nesta aplicação.',action:'Manter oportunidades de descanso, apoio e comunicação de fadiga; monitorar a evolução sem concluir ausência de risco.',followUp:'Reavaliar no próximo ciclo e ouvir sugestões voluntárias da equipe.'}];
}
export function aggregate(rows){
 rows=rows.filter(row=>Object.hasOwn(GROUPS,row.group)&&row.survey_version===VERSION);
 rows.forEach((row,i)=>validateSubmission({...row,submission_id:i.toString(16).padStart(32,'0')}));
 if(rows.length<MIN_GROUP)throw Error('INSUFFICIENT_RESPONDENTS');
 const counts=Object.fromEntries(Object.keys(GROUPS).map(k=>[k,rows.filter(r=>r.group===k).length])),hidden=new Set(Object.keys(GROUPS).filter(k=>counts[k]<MIN_GROUP));
 const residual=[...hidden].reduce((n,k)=>n+counts[k],0);
 if(residual>0&&residual<MIN_GROUP){const secondary=Object.keys(GROUPS).filter(k=>!hidden.has(k)).sort((a,b)=>counts[a]-counts[b]||a.localeCompare(b))[0];if(secondary)hidden.add(secondary);}
 const overall=means(rows),groups=Object.fromEntries(Object.entries(GROUPS).map(([key,label])=>[key,hidden.has(key)?{label,suppressed:true,reason:'Não divulgado por proteção de grupos pequenos ou proteção complementar.'}:{label,suppressed:false,...means(rows.filter(r=>r.group===key))}]));
 // Optional-stress contributors need their own protection against differencing.
 if(overall.perceivedStress){const visible=Object.values(groups).reduce((n,g)=>n+(g.perceivedStress?.respondents||0),0),residualRaters=overall.perceivedStress.respondents-visible;if(residualRaters>0&&residualRaters<MIN_GROUP)overall.perceivedStress=null;}
 return {survey_cycle:CYCLE,survey_version:VERSION,uniquePeopleVerified:true,overall,groups,opportunities:opportunities(overall),methodology:'Snapshot único após encerramento. Somente a etapa com controle autenticado de participação entra neste recorte; registros anteriores permanecem preservados fora destes indicadores. Geral e médias por grupo com supressão complementar. Não se publicam contagens por faixa ou percentuais de alta/muito alta, para impedir reconstrução de células pequenas ao cruzar com médias. As faixas e limiares gerenciais são institucionais, não diagnósticos.'};
}
