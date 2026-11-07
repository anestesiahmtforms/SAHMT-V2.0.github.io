export const escapeNoticeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function linkedNoticeText(value) {
  const text = String(value ?? '');
  const links = /https?:\/\/[^\s<>"']+|#\/[A-Za-z0-9][^\s<>"']*/gi;
  let html = '';
  let end = 0;
  for (const match of text.matchAll(links)) {
    html += escapeNoticeHtml(text.slice(end, match.index));
    end = match.index + match[0].length;
    const raw = match[0];
    let url = raw.replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && url.split(')').length > url.split('(').length) url = url.slice(0, -1);
    try {
      const parsed = new URL(url, 'https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/');
      if (parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) throw Error('Link inválido');
      const external = parsed.origin !== 'https://anestesiahmtforms.github.io';
      html += `<a href="${escapeNoticeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeNoticeHtml(url)}</a>${escapeNoticeHtml(raw.slice(url.length))}`;
    } catch {
      html += escapeNoticeHtml(raw);
    }
  }
  return (html + escapeNoticeHtml(text.slice(end))).replace(/\r?\n/g, '<br>');
}
