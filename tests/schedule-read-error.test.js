import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleReadFailure} from '../src/schedule-read-error.js';
test('schedule diagnostic distinguishes permission, exchange and login failures without provider content',()=>{
 assert.match(scheduleReadFailure({code:'permission-denied'}).message,/recusou/);
 assert.match(scheduleReadFailure({code:'MODULE_SESSION_UNAVAILABLE',phase:'exchange'}).reference,/exchange/);
 assert.match(scheduleReadFailure({code:'MODULE_AUTH_INVALID_TOKEN',phase:'target-login'}).reference,/target-login/);
 const unsafe=scheduleReadFailure({code:'private-token',message:'secret',phase:'private-user'});
 assert.equal(unsafe.reference,'FJ · READ_FAILED');assert.doesNotMatch(JSON.stringify(unsafe),/private|secret/);
});
