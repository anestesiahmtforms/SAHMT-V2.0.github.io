export const OFFLINE_SCHEDULE_IMAGES = Object.freeze([
  {id: 'segunda', short: 'Seg', title: 'Segunda-feira', file: 'segunda-2026.jpg', alt: 'Escala de segunda-feira 2026'},
  {id: 'terca', short: 'Ter', title: 'Terça-feira', file: 'terca-2026.jpg', alt: 'Escala de terça-feira 2026'},
  {id: 'quarta', short: 'Qua', title: 'Quarta-feira', file: 'quarta-2026.jpg', alt: 'Escala de quarta-feira 2026'},
  {id: 'quinta', short: 'Qui', title: 'Quinta-feira', file: 'quinta-2026.jpg', alt: 'Escala de quinta-feira 2026'},
  {id: 'sexta', short: 'Sex', title: 'Sexta-feira', file: 'sexta-2026.jpg', alt: 'Escala de sexta-feira 2026'},
  {id: 'sabado', short: 'Sáb', title: 'Sábado', file: 'sabado-2026.jpg', alt: 'Escala de sábado 2026'},
  {id: 'ferias', short: 'Férias', title: 'Férias 2026', file: 'ferias-2026.jpg', alt: 'Escala de férias 2026'}
]);

export async function cacheOfflineScheduleImages({baseUrl, fetchImage, onStatus}) {
  if (typeof fetchImage !== 'function') throw new Error('A função de leitura das imagens não foi informada.');
  const results = await Promise.allSettled(OFFLINE_SCHEDULE_IMAGES.map(({file}) => fetchImage(`${baseUrl}assets/offline-schedule/${file}`)));
  const cached = results.filter((result) => result.status === 'fulfilled').length;
  if (cached === OFFLINE_SCHEDULE_IMAGES.length) {
    onStatus?.('As sete imagens foram carregadas neste aparelho para consulta offline.');
  } else if (cached > 0) {
    onStatus?.(`${cached} de ${OFFLINE_SCHEDULE_IMAGES.length} imagens estão disponíveis. Conecte-se para completar a cópia offline.`);
  } else {
    onStatus?.('Não foi possível carregar as imagens. Conecte-se e abra esta área para preparar a consulta offline.');
  }
  return {cached, total: OFFLINE_SCHEDULE_IMAGES.length};
}

export function offlineScheduleGalleryMarkup(baseUrl) {
  const navigation = OFFLINE_SCHEDULE_IMAGES.map(({id, short}) => `<a href="#offline-schedule-${id}">${short}</a>`).join('');
  const cards = OFFLINE_SCHEDULE_IMAGES.map(({id, title, file, alt}, index) => `<section id="offline-schedule-${id}" class="offline-schedule-image-card${id === 'ferias' ? ' offline-schedule-image-card--vacation' : ''}"><h4>${title}</h4><img src="${baseUrl}assets/offline-schedule/${file}" alt="${alt}" ${index ? 'loading="lazy"' : 'fetchpriority="low"'} decoding="async"></section>`).join('');
  return `<section class="offline-schedule-gallery" aria-labelledby="offline-schedule-title"><header class="offline-schedule-heading"><div><p class="eyebrow">CONSULTA SEM CONEXÃO</p><h3 id="offline-schedule-title">Escala/Férias 2026</h3></div><button type="button" class="secondary-button" id="offline-schedule-prepare">Preparar imagens offline</button></header><p class="offline-schedule-intro">Cópia visual estática de 2026. Ela não recebe atualizações do Firestore; confirme no calendário quando houver conexão.</p><p id="offline-schedule-cache-status" class="record-meta" role="status" aria-live="polite"></p><nav class="offline-schedule-nav" aria-label="Ir para uma escala">${navigation}</nav>${cards}</section>`;
}
