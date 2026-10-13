import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(process.env.SAHMT_FIRESTORE_RULES_FILE || new URL('../firestore.rules', import.meta.url), 'utf8');
// Preserve offsets, including URLs and braces inside string literals.
const masked = source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
  value => value.replace(/[^\r\n]/g, ' '));
function closingBrace(open) {
  let depth = 1;
  for (let i = open + 1; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    if (masked[i] === '}' && --depth === 0) return i;
  }
  throw new Error('Unclosed rules block');
}
const matches = [...masked.matchAll(/\bmatch\s+(\S+)\s*\{/g)].map(match => {
  const open = match.index + match[0].length - 1;
  return {path: match[1], open, close: closingBrace(open)};
});
const scopesAt = index => matches.filter(match => match.open < index && match.close > index);
const functions = [...masked.matchAll(/\bfunction\s+(\w+)\s*\(/g)]
  .map(match => ({name: match[1], scopes: scopesAt(match.index)}));
const scopeOf = name => functions.find(fn => fn.name === name)?.scopes.at(-1)?.path;

test('collection-specific helpers do not rebuild a large global scope tree', () => {
  const rootCount = functions.filter(fn => fn.scopes.length === 1).length;
  assert.ok(rootCount <= 32, `${rootCount} root helpers: localize collection-specific validators to avoid Rules compiler HTTP 503`);
});

test('identity and permission checks remain shared across collections', () => {
  for (const name of ['signedIn', 'profile', 'activeUser', 'isAdmin', 'can']) {
    assert.equal(scopeOf(name), '/databases/{database}/documents', name);
  }
});

test('schema validators are scoped to the collections that use them', () => {
  const expected = {
    validUserProfile: '/users/{uid}',
    validChecklistRecord: '/checklists/{checklistId}',
    validChecklistSignatureRequest: '/checklistSignatureRequests/{requestId}',
    validEvaluationRequest: '/evaluationRequests/{id}',
    validEventRecord: '/events/{eventId}',
    validLabelRecord: '/labels/{labelId}',
    validManagementIndicator: '/indicators/{indicatorId}',
    validTraining: '/trainings/{trainingId}'
  };
  for (const [name, scope] of Object.entries(expected)) assert.equal(scopeOf(name), scope, name);
});

test('helper names remain unique and the default deny stays explicit', () => {
  assert.equal(new Set(functions.map(fn => fn.name)).size, functions.length);
  assert.match(source, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/);
});
