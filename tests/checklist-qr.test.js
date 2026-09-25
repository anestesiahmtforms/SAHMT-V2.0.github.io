import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findStationForQr, stationIsInDateRange, stationIsValidOn} from '../src/checklist-qr.js';

const stations = [
  {id: 'bloco-1', name: 'Bloco cirúrgico 1', qrCode: 'SAHMT:CHK:0001', active: true},
  {id: 'rpa-2', name: 'RPA 2', qrCode: '', active: true}
];

test('resolve QR pelo valor cadastrado ou ID estável da estação', () => {
  assert.equal(findStationForQr(stations, 'SAHMT:CHK:0001', '2026-09-24'), stations[0]);
  assert.equal(findStationForQr(stations, 'rpa-2', '2026-09-24'), stations[1]);
});

test('ignora espaços externos e recusa valor vazio/desconhecido sem buscar por nome', () => {
  assert.equal(findStationForQr(stations, '  SAHMT:CHK:0001  ', '2026-09-24'), stations[0]);
  assert.equal(findStationForQr(stations, '', '2026-09-24'), null);
  assert.equal(findStationForQr(stations, 'Bloco cirúrgico 1', '2026-09-24'), null);
  assert.equal(findStationForQr(stations, 'SAHMT:CHK:9999', '2026-09-24'), null);
  assert.equal(findStationForQr(stations, 'SAHMT:CHK:0001'), null);
});

test('recusa QR duplicado em mais de uma estação ativa', () => {
  const duplicated = [...stations, {id: 'bloco-2', name: 'Bloco cirúrgico 2', qrCode: 'SAHMT:CHK:0001', active: true}];
  assert.equal(findStationForQr(duplicated, 'SAHMT:CHK:0001', '2026-09-24'), null);
});

test('aplica vigência da estação à data do checklist', () => {
  const station = {id: 'sala-1', qrCode: 'QR-1', active: true, start: '2026-09-01', end: '2026-09-30'};
  assert.equal(stationIsValidOn(station, '2026-09-24'), true);
  assert.equal(stationIsValidOn(station, '2026-10-01'), false);
  assert.equal(stationIsValidOn({...station, active: false}, '2026-09-24'), false);
  assert.equal(stationIsInDateRange({...station, active: false}, '2026-09-24'), true);
  assert.equal(stationIsValidOn({...station, start: '2026-10-01'}, '2026-09-24'), false);
  assert.equal(findStationForQr([station], 'QR-1', '2026-10-01'), null);
  assert.equal(stationIsValidOn(station, ''), false);
  assert.equal(stationIsValidOn({...station, active: undefined}, '2026-09-24'), false);
});
