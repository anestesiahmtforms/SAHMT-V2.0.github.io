import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const homeTemplate=source.slice(source.indexOf('function shellView()'),source.indexOf('async function loadHome()'));
const routeRenderer=source.slice(source.indexOf('async function render()'),source.indexOf('function renderOnlineGate()'));
test('Home removes retired notices without fetching FF inbox on entry',()=>{
 assert.ok(homeTemplate.length>0);
 assert.ok(routeRenderer.length>0);
 assert.doesNotMatch(homeTemplate,/Central de Comunicação/);
 assert.doesNotMatch(homeTemplate,/data-route="communications"/);
 assert.doesNotMatch(homeTemplate,/data-route="year-end-schedule"/);
 assert.doesNotMatch(homeTemplate,/data-comm-home-banners|INBOX|mountCommunicationHomeBanners/);
 assert.doesNotMatch(routeRenderer,/mountCommunicationHomeBanners|data-comm-home-banners/);
 assert.doesNotMatch(source,/preloadOperationalDataWhenIdle/);
 assert.doesNotMatch(source,/preloadOperationalDataWhenIdle\(next\.user\)/);
 assert.doesNotMatch(source,/yearEndStartup\.setSession\(next\)/);
 assert.match(routeRenderer,/requestedRoute==='year-end-schedule'\)yearEndStartup\.setSession\(session\)/);
});
