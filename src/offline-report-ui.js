const CONFIG = Object.freeze({
  events: {label: 'Eventos', title: 'RELATÓRIO'},
  labels: {label: 'Etiquetas', title: 'RELATÓRIO'},
  checklist: {label: 'Checklist', title: 'RELATÓRIO'}
});

function displayValue(value) {
  if (value == null || typeof value === 'object') return '';
  return String(value).trim();
}

function summarize(kind, record) {
  const fields = {
    events: ['memberStatus', 'memberName', 'eventType', 'description', 'date'],
    labels: ['patientName', 'type', 'encounterCode', 'date'],
    checklist: ['stationName', 'condition', 'occurrence', 'date']
  }[kind];
  return fields.map(field => displayValue(record?.[field])).filter(Boolean).join(' · ');
}

export function createOfflineReportView({kind, period, day = '', records = [], hasSnapshot = false} = {}) {
  const config = CONFIG[kind];
  if (!config || !['daily', 'monthly'].includes(period)) {
    return {available: false, title: 'RELATÓRIO', message: 'Este relatório não está disponível offline.'};
  }
  const title = `${config.title} ${period === 'daily' ? 'DIÁRIO' : 'MENSAL'} - ${config.label.toUpperCase()}`;
  if (period === 'monthly') {
    return {available: false, title, message: 'O relatório mensal não está salvo neste aparelho. Conecte-se para carregá-lo. Esta abertura não consultou o Firestore.'};
  }
  if (!hasSnapshot || !Array.isArray(records)) {
    return {available: false, title, message: 'Ainda não há cópia do relatório diário neste aparelho. Conecte-se e abra o relatório para salvar uma cópia local. Esta abertura não consultou o Firestore.'};
  }
  const lines = records.map(record => summarize(kind, record)).filter(Boolean);
  return {
    available: true,
    title,
    message: lines.length
      ? `Cópia local de ${day || 'hoje'} · ${lines.length} registro(s)\n\n${lines.join('\n')}`
      : `Nenhum registro de ${config.label.toLowerCase()} deste dia está disponível na cópia deste aparelho. Esta abertura não consultou o Firestore.`
  };
}

export function bindOfflineOperationalReports({root = document, kind, day, snapshot} = {}) {
  const config = {
    events: {launch: '[data-event-report-launch]', value: 'eventReportLaunch', dialog: '#event-report-dialog', title: '#event-report-dialog-title', status: '#event-report-sync', results: '#event-report-results', day: '#event-day-control', month: '#event-month-control'},
    labels: {launch: '[data-label-report-launch]', value: 'labelReportLaunch', dialog: '#label-report-dialog', title: '#label-report-dialog-title', status: '#label-report-sync', results: '#label-report-results', day: '#label-day-control', month: '#label-month-control'},
    checklist: {launch: '[data-checklist-report-launch]', value: 'checklistReportLaunch', dialog: '#checklist-report-dialog', title: '#checklist-report-title', status: '#checklist-report-sync', results: '.checklist-report-content', day: '#checklist-day-control', month: '#checklist-month-control'}
  }[kind];
  if (!config || typeof root?.querySelectorAll !== 'function') return 0;
  const dialog = root.querySelector(config.dialog);
  const title = dialog?.querySelector(config.title);
  const status = dialog?.querySelector(config.status);
  const results = dialog?.querySelector(config.results);
  if (!dialog || !title || !status || !results) return 0;
  let bound = 0;
  for (const button of root.querySelectorAll(config.launch)) {
    button.disabled = false;
    button.addEventListener('click', () => {
      const view = createOfflineReportView({kind, period: button.dataset?.[config.value], day,
        records: snapshot?.records, hasSnapshot: Array.isArray(snapshot?.records)});
      title.textContent = view.title;
      status.textContent = view.available ? 'CÓPIA LOCAL · SEM ACESSO AO FIRESTORE' : 'DADOS LOCAIS LIMITADOS';
      results.textContent = view.message;
      results.hidden = false;
      const dailyControl = dialog.querySelector(config.day);
      const monthlyControl = dialog.querySelector(config.month);
      if (dailyControl) dailyControl.hidden = true;
      if (monthlyControl) monthlyControl.hidden = true;
      if (!dialog.open) dialog.showModal();
    });
    bound++;
  }
  return bound;
}
