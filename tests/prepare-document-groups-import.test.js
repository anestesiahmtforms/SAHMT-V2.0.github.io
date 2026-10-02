import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDocumentGroupsImport, importSummary} from '../scripts/prepare-document-groups-import.js';
const area = 'area-gestao-de-documentos';
function fixture() {
  const common = {schema: 1, project: 'sahmt-17a16', managementAreaId: area};
  const audience = {...common, documentsActive: false, groups: ['GENERAL', 'RESTRICTED'].map((accessMode, index) => ({id: `document-group-${index}`, name: accessMode, category: index ? 'POLITICAS E REGIMENTOS' : 'ACESSO GERAL', accessMode, sourceFolderId: `fictitious-folder-${index}`, allowedEmails: index ? ['reader@example.invalid'] : ['reader@example.invalid', 'another@example.invalid'], managerEmails: ['manager@example.invalid']}))};
  const files = audience.groups.map((group, index) => ({...common, sourceFolderId: group.sourceFolderId, active: false, requiredReading: false, files: [{driveFileId: `fictitious-file-${index}`, mimeType: 'application/pdf', sourceUrl: `https://drive.google.com/file/d/fictitious-file-${index}/view`, title: `Referência fictícia ${index}`, description: 'Dados fictícios sem informações de pacientes.'}]}));
  return {audience, files};
}

test('prévia mantém os dois grupos e todos os documentos inativos sem gravar produção', () => {
  const {audience, files} = fixture();
  const plan = prepareDocumentGroupsImport(audience, files);
  assert.equal(plan.productionWrites, 0);
  assert.equal(plan.documents.length, 2);
  assert.ok(plan.documents.every(item => item.active === false && item.requiredReading === false));
  assert.equal(plan.documents[1].category, 'POLITICAS E REGIMENTOS');
  assert.equal(plan.documents[1].documentGroupId, audience.groups[1].id);
  assert.deepEqual(plan.documents.map(item => item.id), prepareDocumentGroupsImport(audience, files).documents.map(item => item.id));
  assert.equal(plan.sourceFingerprint, prepareDocumentGroupsImport(audience, files).sourceFingerprint);
});

test('resumo de prévia não imprime listas de e-mail nem conteúdo dos documentos', () => {
  const {audience, files} = fixture();
  const summary = importSummary(prepareDocumentGroupsImport(audience, files));
  assert.equal(summary.inactiveDocuments, 2);
  assert.equal(summary.groups[0].audience, 2);
  assert.doesNotMatch(JSON.stringify(summary), /@example|fictitious-file|Referência fictícia/);
});

test('recusa projeto, área ou ativação fora da fonte aprovada', () => {
  const {audience, files} = fixture();
  for (const overrides of [{project: 'other-project'}, {managementAreaId: 'other-area'}, {documentsActive: true}]) assert.throws(() => prepareDocumentGroupsImport({...audience, ...overrides}, files), /Fonte fora/);
  assert.throws(() => prepareDocumentGroupsImport(audience, [{...files[0], active: true}, files[1]]), /Inventário fora/);
});

test('recusa pastas, arquivos duplicados e link que não pertence ao ID', () => {
  const {audience, files} = fixture();
  assert.throws(() => prepareDocumentGroupsImport(audience, [files[0], files[0]]), /duplicados/);
  assert.throws(() => prepareDocumentGroupsImport(audience, [files[0], {...files[1], sourceFolderId: 'unrelated-folder'}]), /não corresponde/);
  const altered = structuredClone(files); altered[1].files[0].driveFileId = 'another-file-id';
  assert.throws(() => prepareDocumentGroupsImport(audience, altered), /ID não corresponde/);
});

test('recusa equipe restrita fora da geral e tipos de arquivo incompatíveis', () => {
  const {audience, files} = fixture();
  const altered = structuredClone(audience); altered.groups[1].allowedEmails = ['outside@example.invalid'];
  assert.throws(() => prepareDocumentGroupsImport(altered, files), /também deve constar/);
  const alteredFiles = structuredClone(files); alteredFiles[0].files[0].mimeType = 'text/html';
  assert.throws(() => prepareDocumentGroupsImport(audience, alteredFiles), /Tipo de arquivo/);
});

test('não copia campos extras da fonte para o esquema dos grupos', () => {
  const {audience, files} = fixture(); audience.groups[0].unexpected = 'não deve ir para produção';
  const plan = prepareDocumentGroupsImport(audience, files);
  assert.equal('unexpected' in plan.groups[0], false);
});