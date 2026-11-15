const app = new URL('https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/');
const trainingRoute = '#/management/area-gestao-de-documentos/required/';

export function trainingActivityRoute(id) {
  return trainingRoute + encodeURIComponent(id);
}

export function trainingIdFromAppLink(link) {
  try {
    const url = new URL(link.trim(), app);
    if (url.origin !== app.origin || url.username || url.password ||
        ![app.pathname, app.pathname + 'gestao/'].includes(url.pathname) ||
        !url.hash.startsWith(trainingRoute)) return '';
    const [encodedId, noticeId, extra] = url.hash.slice(trainingRoute.length).split('/');
    if (extra !== undefined || (noticeId !== undefined && !/^activity-[a-zA-Z0-9-]{1,100}$/.test(noticeId))) return '';
    const id = decodeURIComponent(encodedId);
    return /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}
