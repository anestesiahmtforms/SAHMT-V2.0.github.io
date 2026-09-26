import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(scriptDirectory, '../.local-preview/user-contact-import-preview.json');
const previewPath = path.resolve(process.argv[2] || defaultPath);
const errors = [];
const fail = (message) => errors.push(message);
const hasExactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const string = (value) => typeof value === 'string';
const includedColumns = ['email', 'name', 'sigla', 'phone', 'active'];
const excludedColumns = ['access', 'training', 'signer', 'writeEvents', 'directChecklist', 'role', 'profile'];
const recordKeys = ['id', 'sourceRow', 'email', 'displayName', 'sigla', 'phone', 'legacyActive', 'duplicateSigla', 'profileReview', 'contactReview'];
const profileKeys = ['decision', 'firebaseUid', 'role', 'active', 'access', 'permissions'];
const contactKeys = ['decision', 'sigla', 'active', 'role', 'whatsAppLink', 'crm', 'entryDate'];

try {
  const preview = JSON.parse(await readFile(previewPath, 'utf8'));
  if (preview.previewOnly !== true || preview.writeEnabled !== false) fail('A prévia precisa declarar previewOnly=true e writeEnabled=false.');
  if (preview.source?.spreadsheet !== 'SAHMT_DATABASE' || preview.source?.sheet !== 'USUARIOS' || preview.source?.range !== 'J1:N61') fail('A origem precisa ser o intervalo delimitado SAHMT_DATABASE/USUARIOS!J1:N61.');
  if (JSON.stringify(preview.source?.includedColumns) !== JSON.stringify(includedColumns)) fail('A lista de colunas lidas não corresponde ao escopo de prévia aprovado.');
  if (JSON.stringify(preview.source?.excludedColumns) !== JSON.stringify(excludedColumns)) fail('A lista de colunas excluídas não corresponde ao escopo aprovado.');
  if (!Array.isArray(preview.records)) fail('records precisa ser uma lista.');

  const ids = new Set();
  const rows = new Set();
  const emails = new Set();
  let pendingContact = 0;
  let missingSigla = 0;
  let legacyActiveCount = 0;
  let duplicateSiglaCount = 0;
  for (const [index, entry] of (preview.records || []).entries()) {
    const label = `registro ${index + 1}`;
    if (!hasExactKeys(entry, recordKeys)) fail(`${label}: campos diferentes do contrato de prévia.`);
    if (!string(entry.id) || !entry.id || ids.has(entry.id)) fail(`${label}: id ausente ou duplicado.`);
    else ids.add(entry.id);
    if (!Number.isInteger(entry.sourceRow) || entry.sourceRow < 2 || entry.sourceRow > 61 || rows.has(entry.sourceRow)) fail(`${label}: sourceRow inválida ou duplicada.`);
    else rows.add(entry.sourceRow);
    for (const field of ['email', 'displayName', 'sigla', 'phone']) if (!string(entry[field])) fail(`${label}: tipo inválido em ${field}.`);
    if (string(entry.email) && !entry.email.trim()) fail(`${label}: e-mail vazio.`);
    else if (string(entry.email) && emails.has(entry.email.trim().toLocaleLowerCase('pt-BR'))) fail(`${label}: e-mail repetido.`);
    else if (string(entry.email)) emails.add(entry.email.trim().toLocaleLowerCase('pt-BR'));
    if (typeof entry.legacyActive !== 'boolean' || typeof entry.duplicateSigla !== 'boolean') fail(`${label}: estado descritivo ou indicador de duplicidade inválido.`);
    if (entry.legacyActive === true) legacyActiveCount++;
    if (entry.duplicateSigla === true) duplicateSiglaCount++;

    const profile = entry.profileReview;
    if (!hasExactKeys(profile, profileKeys) || profile.decision !== 'PENDING_UID_ROLE_PERMISSION_REVIEW') fail(`${label}: revisão de perfil não permanece pendente.`);
    else if (['firebaseUid', 'role', 'active', 'access', 'permissions'].some((field) => profile[field] !== null)) fail(`${label}: contém uma atribuição de identidade ou autorização V2.`);

    const contact = entry.contactReview;
    if (!hasExactKeys(contact, contactKeys)) fail(`${label}: campos de revisão de contato diferentes do contrato.`);
    else {
      const hasSigla = entry.sigla.trim().length > 0;
      const expectedDecision = hasSigla ? 'PENDING' : 'NEEDS_CONFIRMED_SIGLA';
      if (contact.decision !== expectedDecision || (contact.sigla ?? '') !== entry.sigla) fail(`${label}: revisão do contato não corresponde à sigla candidata.`);
      if (['active', 'role', 'whatsAppLink', 'crm', 'entryDate'].some((field) => contact[field] !== null)) fail(`${label}: contém campos de contato ainda não revisados.`);
      if (!hasSigla) missingSigla++;
      if (contact.decision === 'PENDING') pendingContact++;
    }
  }

  if (preview.records?.length !== 60) fail('A contagem da prévia difere dos 60 registros delimitados; revisar a origem antes de continuar.');
  if (rows.size !== 60 || ids.size !== 60) fail('IDs e linhas de origem precisam ser únicos para os 60 registros.');
  if (emails.size !== 60 || preview.counts?.rows !== 60 || preview.counts?.distinctEmails !== 60 || preview.counts?.legacyInactive !== 1 || preview.counts?.withSigla !== 31 || preview.counts?.withoutSigla !== 29) fail('Os totais informativos não correspondem aos dados da prévia.');
  if (missingSigla !== 29 || pendingContact !== 31) fail('As contagens de contatos aguardando revisão diferem do snapshot documentado.');
  if (legacyActiveCount !== 59 || duplicateSiglaCount !== 0) fail('Os indicadores descritivos não correspondem ao snapshot delimitado.');
  if (errors.length) {
    console.error(`Prévia reprovada (${errors.length} problema(s)); nenhum dado pessoal foi exibido.`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Prévia válida: ${preview.records.length} registros; ${pendingContact} contatos aguardando conferência e ${missingSigla} sem sigla confirmada. Nenhum dado pessoal foi exibido; nenhuma gravação foi feita.`);
  }
} catch {
  console.error('Não foi possível validar a prévia local; confirme o caminho e o formato JSON. Nenhum conteúdo do arquivo foi exibido.');
  process.exitCode = 1;
}
