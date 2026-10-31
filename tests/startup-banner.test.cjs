const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
test('opening contains only the logo and has no fixed wait or campaign status gate', () => {
  assert.doesNotMatch(main, /STARTUP_BANNER_DURATION_MS|yearEndStartup.status==='checking'/);
  const logo=main.slice(main.indexOf('if (startupBannerActive || session.status'),main.indexOf('  if(!navigator.onLine',main.indexOf('if (startupBannerActive || session.status')));
  assert.match(logo,/startup-logo/);assert.match(logo,/<img /);
  assert.doesNotMatch(logo,/<strong|boot-slogan|boot-spinner|boot-particles/);
  assert.match(main,/startupBannerActive=\['checking','loading-profile'\].includes\(next.status\)/);
});
