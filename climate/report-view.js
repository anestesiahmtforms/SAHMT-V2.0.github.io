const score = value => value ? `${value.favorable}% favoráveis (${value.numerator}/${value.denominator} respostas válidas)` : 'Não divulgado para preservar grupos pequenos ou por ausência de respostas válidas';
export function renderReport(document,data,plan) {
  const section=document.createElement('section'),title=document.createElement('h2');title.textContent=`Ciclo ${data.survey_cycle}`;section.append(title);
  const metric=(host,label,value)=>{const p=document.createElement('p');p.className='metric';const strong=document.createElement('strong');strong.textContent=`${label}: `;p.append(strong,document.createTextNode(value));host.append(p);};
  metric(section,'Adesão','Não divulgada para proteger a participação de grupos pequenos.');
  for(const [key,label] of [['team','Equipe'],['resident','Residentes'],['substitute','Substitutos']]) {
    const group=data.groups?.[key],card=document.createElement('section'),heading=document.createElement('h3');heading.textContent=label;card.append(heading);card.dataset.resultGroup=key;
    if(!group||group.suppressed){const p=document.createElement('p');p.textContent=group?.reason||'Este relatório anterior não possui classificação por grupo.';card.append(p);}
    else {
      for(const [label,value]of [['Índice favorável',score(group.general)],...(group.dimensions||[]).map(d=>[d.label,score(d.score)]),['Segurança psicológica',score(group.psychologicalSafety)],['Percepção de cultura de segurança',score(group.safetyCulture)],['Intenção de contribuição',score(group.contribution)],['Confiança no ciclo de melhoria',score(group.improvementTrust)]])metric(card,label,value);
    }
    section.append(card);
  }
  const actionScore=value=>value?.denominator?`${value.percent}% (${value.numerator}/${value.denominator})`:'Sem denominador informado';
  metric(section,'Ações concluídas no prazo',actionScore(plan?.onTime));metric(section,'Ações com efetividade verificada',actionScore(plan?.effectiveness));
  const note=document.createElement('p');note.textContent='Equipe reúne os anestesiologistas, com e sem preceptoria. N/A e branco não entram nos denominadores. Respostas sem grupo informado não são classificadas. Grupos pequenos permanecem protegidos. Categorias descontinuadas não são exibidas.';section.append(note);
  return section;
}
