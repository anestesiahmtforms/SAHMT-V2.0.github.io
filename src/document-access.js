export const DOCUMENT_GROUPS = Object.freeze(['GENERAL', 'RESTRICTED']);
export const SCOPED_DOCUMENT_COLLECTION = 'scopedDocuments';

export function normalizeDocumentAccessEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    throw new Error('Informe um e-mail válido, sem espaços ou barras.');
  }
  return email;
}

export function documentGroupsFromAccess(record, email) {
  if (!record || record.id !== email || record.email !== email || record.active !== true ||
      !Array.isArray(record.groups) || record.groups.length > 2 || new Set(record.groups).size !== record.groups.length ||
      record.groups.some(group => !DOCUMENT_GROUPS.includes(group))) return [];
  return DOCUMENT_GROUPS.filter(group => record.groups.includes(group));
}

export function documentCollectionForWrite(input) {
  const name = input.documentCollection || 'documents';
  if (!['documents', SCOPED_DOCUMENT_COLLECTION].includes(name)) throw new Error('Origem do documento inválida.');
  if (name === 'documents' && input.audienceGroup) throw new Error('O público de documentos antigos não pode ser alterado neste cadastro.');
  if (name === SCOPED_DOCUMENT_COLLECTION && !DOCUMENT_GROUPS.includes(input.audienceGroup)) throw new Error('Escolha Acesso geral ou Acesso restrito.');
  return name;
}

export function managementDocumentKey(item) {
  return `${item.documentCollection || 'documents'}/${item.id}`;
}

export function mergeManagementDocuments(legacy, scoped, pageSize = 50) {
  const unique = new Map([...legacy, ...scoped].map(item => [managementDocumentKey(item), item]));
  const time = item => item.publishedAt?.toMillis?.() ?? (new Date(item.publishedAt).getTime() || 0);
  return [...unique.values()].sort((a, b) => time(b) - time(a) || managementDocumentKey(a).localeCompare(managementDocumentKey(b)))
    .slice(0, Math.min(100, Math.max(1, pageSize)));
}
