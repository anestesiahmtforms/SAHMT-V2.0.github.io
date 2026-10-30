/** Presentation labels only; the original title remains the accessible name. */
export function compactTrainingTitle(title='Documento') {
  const labels=[
    [/^Acionamento imediato do anestesista na SRPA/i,'Acionamento imediato — SRPA'],
    [/^Acionamento do anestesiologista na SRPA/i,'Acionamento do anestesista — SRPA'],
    [/^Náuseas e vômitos pós-operatórios/i,'Náuseas e vômitos pós-op. (NVPO)'],
    [/^Diabetes e hiperglicemia perioperatória/i,'Diabetes e hiperglicemia'],
    [/^Eventos hemorrágicos perioperatórios/i,'Hemorragia perioperatória / ROTEM'],
    [/^Cuidado anestésico com pacientes graves/i,'Anestesia em pacientes graves'],
    [/^Plano de desastre e múltiplas vítimas/i,'Desastre e múltiplas vítimas'],
    [/^Lista de verificação para cirurgia segura/i,'Checklist de cirurgia segura'],
    [/^Conciliação medicamentosa nas transições de atendimento:.*aguda/i,'Conciliação — internação'],
    [/^Conciliação medicamentosa nas transições de atendimento:.*ambulatorial/i,'Conciliação — ambulatório'],
    [/^Conciliação de medicamentos como prioridade estratégica/i,'Conciliação — estratégia'],
    [/^Transferência de informações nas transições de atendimento/i,'Transferência de informações'],
    [/^Preparo e transporte do arsenal anestésico extrabloco/i,'Arsenal extrabloco — preparo'],
    [/^Intoxicação sistêmica por anestésicos locais/i,'Intoxicação por anestésicos (ISAL)'],
    [/^Política institucional de gestão perioperatória/i,'Gestão perioperatória institucional'],
    [/^Posicionamento, contenção e transposição cirúrgica/i,'Posicionamento e transposição']
  ];
  return labels.find(([pattern])=>pattern.test(title))?.[1]||title;
}
