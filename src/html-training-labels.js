/** Presentation labels only; the original title remains the accessible name. */
export function compactTrainingTitle(title='Documento') {
  const labels=[
    [/^Conciliação medicamentosa nas transições de atendimento:.*aguda/i,'Conciliação — internação'],
    [/^Conciliação medicamentosa nas transições de atendimento:.*ambulatorial/i,'Conciliação — ambulatório'],
    [/^Conciliação de medicamentos como prioridade estratégica/i,'Conciliação — estratégia'],
    [/^Transferência de informações nas transições de atendimento/i,'Transição assistencial — informações'],
    [/^Preparo e transporte do arsenal anestésico extrabloco/i,'Arsenal extrabloco — preparo e transporte'],
    [/^Intoxicação sistêmica por anestésicos locais/i,'Intoxicação por anestésicos locais (ISAL)'],
    [/^Política institucional de gestão perioperatória/i,'Gestão perioperatória institucional'],
    [/^Posicionamento, contenção e transposição cirúrgica/i,'Posicionamento e transposição cirúrgica']
  ];
  return labels.find(([pattern])=>pattern.test(title))?.[1]||title;
}
