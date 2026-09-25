export function normalizeDriveDocumentUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Cole um link válido do Google Drive ou Google Docs.'); }
  if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname)) {
    throw new Error('O documento precisa estar no Google Drive ou Google Docs.');
  }
  const match = url.pathname.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
  const id = match?.[1] || (url.hostname === 'drive.google.com' && url.pathname === '/open' ? url.searchParams.get('id') : '');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id || '')) throw new Error('Não foi possível identificar o arquivo no link informado.');
  return {driveFileId: id, driveUrl: `https://drive.google.com/file/d/${id}/view`};
}
