const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
test('banner de três segundos apresenta os três textos antes de entrar no app', () => {
  assert.match(main, /STARTUP_BANNER_DURATION_MS = 3000;/);
  for (const phrase of ['Gestão responsável!', 'Gestão eficiente!', 'Gestão na palma da mão!']) {
    assert.ok(main.includes('aria-hidden="true">' + phrase + '</span>'));
  }
  const duration = Number(css.match(/animation:sahmt-slogan-in ([\d.]+)s ease both/)[1]);
  const second = Number(css.match(/boot-slogan__phrase:nth-child\(2\).*?animation-delay:([\d.]+)s/)[1]);
  const third = Number(css.match(/boot-slogan__phrase:nth-child\(3\).*?animation-delay:([\d.]+)s/)[1]);
  assert.ok(Math.abs(duration - 1) < .00001);
  assert.ok(Math.abs(second - duration) < .00001);
  assert.ok(Math.abs(third - 2 * duration) < .00001);
  assert.ok(Math.abs(third + duration - 3) < .00001);
  assert.match(css, /first-child\{[^}]*opacity:1;animation-name:sahmt-slogan-first/);
  assert.match(main, /}, STARTUP_BANNER_DURATION_MS\);/);
});
