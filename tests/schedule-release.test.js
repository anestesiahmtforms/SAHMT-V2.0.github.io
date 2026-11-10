import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateScheduleReleaseState, visibleScheduleReleaseSiglas} from '../src/schedule-release.js';

test('posição agregada só fica liberada quando todos os membros do grupo foram liberados', () => {
  const first = updateScheduleReleaseState([], {sigla: 'CR', marked: true, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'});
  assert.deepEqual(first, {siglas: ['CR'], changed: true});
  const second = updateScheduleReleaseState(first.siglas, {sigla: 'LH', marked: true, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'});
  assert.deepEqual(second, {siglas: ['CR', 'LH', 'DC'], changed: true});
});

test('retirar um membro limpa o agregado e preserva outras liberações da data', () => {
  const result = updateScheduleReleaseState(['CR', 'LH', 'DC', 'AB', 'XY'], {
    sigla: 'CR', marked: false, groupSiglas: ['CR', 'LH'], tokenSigla: 'DC'
  });
  assert.deepEqual(result, {siglas: ['LH', 'AB', 'XY'], changed: true});
});

test('sigla simples não duplica o próprio marcador ao alternar liberação', () => {
  const result = updateScheduleReleaseState(['AB'], {sigla: 'AB', marked: false, groupSiglas: ['AB'], tokenSigla: 'AB'});
  assert.deepEqual(result, {siglas: [], changed: true});
  assert.throws(() => updateScheduleReleaseState([], {sigla: 'A1', marked: true}), /inválida/);
});

test('horário por sigla preserva liberações anteriores e limpa a liberação removida', async () => {
  const {updateScheduleReleaseTimes} = await import('../src/schedule-release.js');
  const first = Date.parse('2026-10-09T10:15:00Z');
  const second = Date.parse('2026-10-09T11:42:00Z');
  const times = updateScheduleReleaseTimes({CR: first}, ['CR'], ['CR', 'LH', 'DC'], second);
  assert.deepEqual(times, {CR: first, LH: second, DC: second});
  assert.deepEqual(updateScheduleReleaseTimes(times, ['CR', 'LH', 'DC'], ['LH'], second), {LH: second});
  assert.deepEqual(updateScheduleReleaseTimes({}, ['AB'], ['AB'], second), {});
});

test('hora e minuto usam Brasília e não inventam horários para registros antigos', async () => {
  const {formatScheduleReleaseTime} = await import('../src/schedule-release.js');
  assert.equal(formatScheduleReleaseTime(Date.parse('2026-10-09T10:05:00Z')), '07:05');
  assert.equal(formatScheduleReleaseTime(Date.parse('2026-10-09T01:09:00Z')), '22:09');
  for (const value of [undefined, null, '', NaN, -1]) assert.equal(formatScheduleReleaseTime(value), '');
});

test('a Home mostra marca e horário somente à própria pessoa liberada, inclusive nos grupos', async () => {
  const {readFile} = await import('node:fs/promises');
  const {runInNewContext} = await import('node:vm');
  const {scheduleReleaseIdentity} = await import('../src/communication-operational-notices.js');
  const {scheduleDelayFromMarker} = await import('../src/schedule-event-marker.js');
  const {formatScheduleReleaseTime} = await import('../src/schedule-release.js');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const session = {profile: {sigla: 'CR'}};
  const render = runInNewContext(source.slice(source.indexOf('function vacationRankMarkup'), source.indexOf('function renderLabelManualConfirmation')) + '\nrenderSchedulePositionGrid;', {
    scheduleReleaseIdentity, scheduleDelayFromMarker, formatScheduleReleaseTime, visibleScheduleReleaseSiglas, escapeHtml: value => String(value), can: () => true,
    featureEnabledForRoute: () => true, currentRoute: () => 'home', appFeatures: {}, session
  });
  const position = (sigla, siglas) => ({sigla, siglas, vacationParts: [], vacationPositions: {}, contacts: [{sigla}]});
  const view = {positions: [position('AB', ['AB']), position('CR/LH', ['CR', 'LH']), position('DC', ['CR', 'LH'])], vacationPositions: {}};
  const schedule = {highlights: {siglas: ['AB', 'CR'], events: ['EVENTO:CR/LH:CR:ATRASO:2:late'], releaseTimes: {AB: Date.parse('2026-10-09T10:05:00Z'), CR: Date.parse('2026-10-09T11:42:00Z')}}};
  const html = render(view, {schedule});
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1]);
  assert.doesNotMatch(buttons[0], /07:05|released-part--checked/);
  assert.match(buttons[1], /sigla-token__delay[^>]*>-2<.*<strong>/);
  assert.match(buttons[1], />CR<\/span><small[^>]*>08:42<\/small>/);
  assert.match(buttons[2], />CR<\/span><small[^>]*>08:42<\/small>/);
  assert.doesNotMatch(html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, ''), /07:05|08:42/);
  assert.doesNotMatch(render(view, {mode: 'events', schedule}), /release-time|07:05|08:42/);
  session.profile.sigla = 'AB';
  const ownHtml = render(view, {schedule});
  assert.match(ownHtml, /sigla-token--checked/);
  assert.match(ownHtml, />AB<\/span><small[^>]*>07:05<\/small>/);
  assert.doesNotMatch(ownHtml, /08:42/);
  session.profile.sigla = 'LH';
  assert.doesNotMatch(render(view, {schedule}), /released-part--checked|sigla-token--checked|release-time|Liberação confirmada/);
  session.profile.sigla = '';
  assert.doesNotMatch(render(view, {schedule}), /released-part--checked|sigla-token--checked|release-time/);
  assert.match(render(view, {schedule}), /sigla-token--delay/);
  session.profile = {active: true, access: true, role: 'administrador_app'};
  session.user = {emailVerified: true};
  assert.match(render(view, {schedule}), /07:05/);
  session.profile.role = 'gestor';
  session.user.email = 'marcio.henrique82@gmail.com';
  assert.match(render(view, {schedule}), /07:05/);
});

test('liberação de posição agregada e estado provisório não expõem os outros membros', () => {
  assert.deepEqual(visibleScheduleReleaseSiglas(['CR', 'LH', 'DC'], ' cr '), ['CR']);
  assert.deepEqual(visibleScheduleReleaseSiglas(['AB', 'DC'], 'CR'), []);
  assert.deepEqual(visibleScheduleReleaseSiglas(['AB'], 'DC'), []);
  assert.deepEqual(visibleScheduleReleaseSiglas(undefined, 'AB'), []);
});
