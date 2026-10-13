import assert from 'node:assert/strict';
import test from 'node:test';
import {authSourceRecordDigest} from '../scripts/lib/management-auth-import-plan.js';
import {prepareManagementRetirementImpact} from '../scripts/lib/management-account-retirement-impact.js';

const projectIds = {FA: 'sahmt-17a16', FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'};
const owner = {uid: 'synthetic-owner', email: 'fa-owner@example.invalid', disabled: false, emailVerified: true, providerData: []};
const candidateOne = {uid: 'synthetic-retire-one', email: 'homologation-a@example.invalid', disabled: false, emailVerified: false, providerData: []};
const candidateTwo = {uid: 'synthetic-retire-two', email: 'homologation-b@example.invalid', disabled: false, emailVerified: false, providerData: []};
const unrelated = {uid: 'synthetic-preserve', email: 'former-homologation@example.invalid', disabled: false, emailVerified: true, providerData: []};
const snapshot = (alias, users) => ({projectId: projectIds[alias], coverage: {complete: true}, users});
const profileSnapshot = (alias, profileUids) => ({projectId: projectIds[alias], complete: true, profileUids});
const deps = (alias, references = [], extras = {}) => ({projectId: projectIds[alias], complete: true,
  coverageScope: 'STATIC_REPOSITORY_SCHEMA_ALLOWLIST', unmappedCollectionsReviewed: true, globalAbsenceConfirmed: false,
  collectionsScanned: 6, failures: 0, references, ...extras});
const makeInputs = () => ({
  authSnapshots: {
    FA: snapshot('FA', [owner, candidateOne, candidateTwo, unrelated]),
    FB: snapshot('FB', [candidateOne, unrelated]),
    FC: snapshot('FC', [{...candidateOne, email: 'different@example.invalid'}, {...candidateTwo, uid: 'synthetic-wrong-uid'}, unrelated])
  },
  profileSnapshots: {
    FA: profileSnapshot('FA', [owner.uid, candidateOne.uid, candidateTwo.uid]),
    FB: profileSnapshot('FB', [candidateOne.uid]),
    FC: profileSnapshot('FC', [candidateOne.uid, candidateTwo.uid])
  },
  dependencyIndexes: {
    FA: deps('FA', [
      {uid: candidateOne.uid, category: 'TRAINING', count: 4},
      {uid: candidateOne.uid, category: 'AUDIT', count: 2},
      {uid: candidateTwo.uid, category: 'OPERATIONAL', count: 1}
    ]),
    FB: deps('FB', [{uid: candidateOne.uid, category: 'TRAINING', count: 3}]),
    FC: deps('FC', [{uid: candidateTwo.uid, category: 'AUDIT', count: 5}, {uid: candidateOne.uid, category: 'OTHER', count: 2}])
  },
  structuralOwnerIdentity: {uid: owner.uid, sourceRecordSha256: authSourceRecordDigest(owner)}
});

test('impacto agregado confirma UID/e-mail FA e verifica Auth, perfil e referências em FA/FB/FC', () => {
  const input = makeInputs();
  const before = structuredClone(input);
  const report = prepareManagementRetirementImpact(input);
  assert.equal(report.candidateIdentities.confirmedByUniqueFaUidAndEmail, 2);
  assert.equal(report.candidateIdentities.unresolvedOrAmbiguous, 0);
  assert.equal(report.structuralOwnerProtected, true);
  assert.deepEqual(report.projects.FA.dependencyCounts, {OPERATIONAL: 1, TRAINING: 4, AUDIT: 2, OTHER: 0});
  assert.equal(report.projects.FA.historicalRecordsReferenced, 6);
  assert.deepEqual([report.projects.FB.authSameUidAndEmail, report.projects.FB.authMissing, report.projects.FB.authEmailUidConflict], [1, 1, 0]);
  assert.deepEqual([report.projects.FC.authSameUidAndEmail, report.projects.FC.authMissing, report.projects.FC.authEmailUidConflict], [0, 0, 2]);
  assert.deepEqual(report.projects.FC.dependencyCounts, {OPERATIONAL: 0, TRAINING: 0, AUDIT: 5, OTHER: 2});
  assert.equal(report.projects.FA.blocksAnyDeletionProposal, true, 'active reference blocks a proposal');
  assert.equal(report.projects.FC.blocksAnyDeletionProposal, true, 'ambiguous reference blocks a proposal');
  assert.ok(report.blockingReasons.includes('ACTIVE_DEPENDENCY_FOUND'));
  assert.ok(report.blockingReasons.includes('DEPENDENCY_REQUIRES_REVIEW'));
  assert.ok(report.blockingReasons.includes('DESTINATION_AUTH_IDENTITY_CONFLICT'));
  assert.equal(report.deletionImpact.deletionProposalBlocked, true);
  assert.equal(report.deletionImpact.authAccountsToDeleteAutomatically, 0);
  assert.equal(report.deletionImpact.firestoreDocumentsToDeleteAutomatically, 0);
  assert.equal(report.deletionImpact.historicalTrainingOrAuditRecordsDeleted, 0);
  assert.equal(report.deletionImpact.deletionAllowed, false);
  assert.deepEqual(input, before, 'the preview must not mutate snapshots');
  const serialized = JSON.stringify(report);
  for (const value of [owner.uid, candidateOne.uid, candidateTwo.uid, unrelated.uid, owner.email, candidateOne.email, candidateTwo.email]) assert.equal(serialized.includes(value), false);
});

test('UID do proprietário só é aceito quando o digest e o e-mail estrutural conferem', () => {
  const input = makeInputs();
  input.structuralOwnerIdentity.sourceRecordSha256 = 'f'.repeat(64);
  assert.throws(() => prepareManagementRetirementImpact(input), /RETIREMENT_STRUCTURAL_OWNER_PROOF_INVALID/);
  const wrongEmail = makeInputs();
  wrongEmail.structuralOwnerIdentity = {uid: owner.uid, sourceRecordSha256: authSourceRecordDigest({...owner, email: 'wrong@example.invalid'})};
  assert.throws(() => prepareManagementRetirementImpact(wrongEmail), /RETIREMENT_STRUCTURAL_OWNER_PROOF_INVALID/);
});

test('e-mails ausentes ou ambíguos não identificam UIDs para uma exclusão', () => {
  const input = makeInputs();
  input.authSnapshots.FA.users.push({...candidateOne, uid: 'synthetic-retire-one-duplicate'});
  const report = prepareManagementRetirementImpact(input);
  assert.equal(report.candidateIdentities.confirmedByUniqueFaUidAndEmail, 1);
  assert.equal(report.candidateIdentities.unresolvedOrAmbiguous, 1);
  assert.equal(report.deletionImpact.deletionAllowed, false);
});

test('cobertura de dependências incompleta falha fechada sem relatório que sugira segurança', () => {
  const input = makeInputs();
  input.dependencyIndexes.FC.complete = false;
  assert.throws(() => prepareManagementRetirementImpact(input), /RETIREMENT_DEPENDENCY_COVERAGE_INCOMPLETE/);
});

test('catálogo de código sem conferência de coleções não mapeadas bloqueia qualquer proposta', () => {
  const input = makeInputs();
  for (const index of Object.values(input.dependencyIndexes)) {
    index.references = [];
    index.unmappedCollectionsReviewed = false;
  }
  const report = prepareManagementRetirementImpact(input);
  assert.ok(report.blockingReasons.includes('UNMAPPED_COLLECTIONS_NOT_REVIEWED'));
  assert.equal(report.projects.FC.globalAbsenceConfirmed, false);
  assert.equal(report.projects.FC.blocksAnyDeletionProposal, true);
  assert.equal(report.deletionImpact.deletionAllowed, false);
});
