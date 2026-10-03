import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {normalizeManagementEmails, DOCUMENT_MANAGEMENT_AREA} from '../src/management-document-access.js';
import {normalizeDriveDocumentUrl} from '../src/drive-document.js';

const supportedMimeTypes = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.google-apps.document']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function prepareDocumentGroupsImport(audience, fileSources) {
  assert(audience?.schema === 1 && audience.project === 'sahmt-17a16' && audience.managementAreaId === DOCUMENT_MANAGEMENT_AREA && audience.documentsActive === false, 'Fonte fora do projeto, área ou estado inativo esperado.');
  assert(Array.isArray(audience.groups) && audience.groups.length === 2, 'Informe os dois grupos de documentos.');
  const groups = audience.groups.map((group) => {
    assert(/^[A-Za-z0-9_-]{10,128}$/.test(group.id) && ['GENERAL', 'RESTRICTED'].includes(group.accessMode), 'Confira o ID e o tipo do grupo.');
    assert(typeof group.name === 'string' && group.name.trim().length > 0 && group.name.length <= 120 && typeof group.category === 'string' && group.category.trim().length > 0 && group.category.length <= 80 && /^[A-Za-z0-9_-]{10,200}$/.test(group.sourceFolderId), 'Confira o nome, categoria e pasta do grupo.');
    const allowedEmails = normalizeManagementEmails(group.allowedEmails);
    const managerEmails = normalizeManagementEmails(group.managerEmails, {maxItems: 20});
    assert(allowedEmails.length > 0 && managerEmails.length > 0, 'Cada grupo precisa ter pessoas autorizadas e gestores.');
    return {id: group.id, managementAreaId: DOCUMENT_MANAGEMENT_AREA, name: group.name.trim(), category: group.category.trim(), accessMode: group.accessMode, sourceFolderId: group.sourceFolderId, allowedEmails, managerEmails, active: true};
  });
  assert(new Set(groups.map(group => group.id)).size === 2 && new Set(groups.map(group => group.accessMode)).size === 2 && new Set(groups.map(group => group.sourceFolderId)).size === 2, 'Os grupos devem ter IDs, tipos e pastas distintos.');
  const general = groups.find(group => group.accessMode === 'GENERAL');
  const restricted = groups.find(group => group.accessMode === 'RESTRICTED');
  assert(restricted.allowedEmails.every(email => general.allowedEmails.includes(email)), 'Confira as listas: a equipe restrita também deve constar no acesso geral.');
  assert(Array.isArray(fileSources) && fileSources.length === 2, 'Informe os inventários das duas pastas.');
  const documents = fileSources.flatMap(source => {
    assert(source?.schema === 1 && source.project === audience.project && source.managementAreaId === DOCUMENT_MANAGEMENT_AREA && source.active === false && source.requiredReading === false, 'Inventário fora do escopo inativo autorizado.');
    const group = groups.find(item => item.sourceFolderId === source.sourceFolderId);
    assert(group && Array.isArray(source.files) && source.files.length > 0, 'Inventário não corresponde a uma pasta de grupo.');
    return source.files.map(file => {
      assert(supportedMimeTypes.has(file.mimeType), 'Tipo de arquivo não suportado.');
      const link = normalizeDriveDocumentUrl(file.sourceUrl);
      assert(link.driveFileId === file.driveFileId, 'O ID não corresponde ao link do arquivo.');
      assert(typeof file.title === 'string' && file.title.trim().length > 0 && file.title.length <= 160 && typeof file.description === 'string' && file.description.length <= 1200, 'Metadados inválidos.');
      return {id: 'drive-doc-' + hash(DOCUMENT_MANAGEMENT_AREA + '|' + file.driveFileId), managementAreaId: DOCUMENT_MANAGEMENT_AREA, documentGroupId: group.id, title: file.title.trim(), description: file.description, ...link, category: group.category, active: false, requiredReading: false};
    });
  });
  assert(new Set(fileSources.map(source => source.sourceFolderId)).size === 2 && new Set(documents.map(item => item.driveFileId)).size === documents.length, 'Há inventários ou arquivos duplicados.');
  return {schema: 1, kind: 'DOCUMENT_GROUPS_PREVIEW', project: audience.project, managementAreaId: DOCUMENT_MANAGEMENT_AREA, sourceFingerprint: hash(JSON.stringify({audience, fileSources})), productionWrites: 0, groups, documents};
}

export function importSummary(plan) {
  return {kind: plan.kind, project: plan.project, productionWrites: 0, documents: plan.documents.length, inactiveDocuments: plan.documents.filter(item => !item.active).length, groups: plan.groups.map(group => ({id: group.id, name: group.name, audience: group.allowedEmails.length, managers: group.managerEmails.length, documents: plan.documents.filter(item => item.documentGroupId === group.id).length})), sourceFingerprint: plan.sourceFingerprint};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 4, 'Uso: node scripts/prepare-document-groups-import.js audiencia.json geral.json restrito.json saida.json');
    const plan = prepareDocumentGroupsImport(JSON.parse(fs.readFileSync(args[0], 'utf8')), args.slice(1, 3).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
    fs.writeFileSync(args[3], JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(importSummary(plan), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}