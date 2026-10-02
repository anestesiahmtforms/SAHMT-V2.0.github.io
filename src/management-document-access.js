export const DOCUMENT_MANAGEMENT_AREA = 'area-gestao-de-documentos';

const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);

export function normalizeManagementEmails(value, {maxItems = 100} = {}) {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new Error('Informe os e-mails Google em linhas separadas.');
  }
  const entries = (Array.isArray(value) ? value : value.split(/[\r\n,;]+/))
    .map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(entries)];
  if (unique.some((email) => !validEmail(email))) throw new Error('Confira os e-mails: cada linha deve conter um endereço válido.');
  if (unique.length > maxItems) throw new Error(`Cada lista pode conter no máximo ${maxItems} e-mails.`);
  return unique;
}

export function verifiedManagementEmail(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return user?.emailVerified === true && validEmail(email) ? email : '';
}

export function isManagementDocumentAreaManager(area, uid) {
  return !!uid && area?.active === true && Array.isArray(area.managerUids) && area.managerUids.includes(uid);
}

function matchingGroup(document, area, groups) {
  return groups.find((group) => group.id === document?.documentGroupId && group.managementAreaId === area?.id && group.active === true);
}

export function canManageManagementDocument({document, area, groups = [], user, canManageAll = false, canReadLegacy = false}) {
  if (!user?.uid || !document || document.managementAreaId !== area?.id) return false;
  if (canManageAll) return true;
  if (!canReadLegacy || area?.active !== true) return false;
  if (isManagementDocumentAreaManager(area, user.uid)) return true;
  const group = matchingGroup(document, area, groups);
  const email = verifiedManagementEmail(user);
  return !!email && !!group && Array.isArray(group.managerEmails) && group.managerEmails.includes(email);
}

export function canReadManagementDocument(options) {
  const {document, area, groups = [], user, canManageAll = false, canReadLegacy = false} = options;
  if (!user?.uid || !document || document.managementAreaId !== area?.id) return false;
  if (canManageManagementDocument(options)) return true;
  if (canManageAll) return true;
  if (!canReadLegacy || area?.active !== true || document.active !== true) return false;
  if (!document.documentGroupId) return area.id !== DOCUMENT_MANAGEMENT_AREA;
  const group = matchingGroup(document, area, groups);
  const email = verifiedManagementEmail(user);
  return !!email && !!group && Array.isArray(group.allowedEmails) && group.allowedEmails.includes(email);
}