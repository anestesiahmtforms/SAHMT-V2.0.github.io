export const LABEL_REPORT_TIMEOUT_MS = 12000;

export function labelReportPresentation(state, online = true) {
  if (!online) return {confirmed: false, text: 'Sem conexão'};
  if (state === 'synced') return {confirmed: true, text: 'Sincronizado'};
  if (state === 'loading') return {confirmed: false, text: 'Carregando registros…'};
  if (state === 'error') return {confirmed: false, text: 'Pendente · tentar novamente'};
  return {confirmed: false, text: 'Aguardando consulta'};
}

export async function withLabelReportDeadline(operation, timeoutMs = LABEL_REPORT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('A consulta demorou mais de 12 segundos. Tente novamente.'), {code: 'deadline-exceeded'})), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
