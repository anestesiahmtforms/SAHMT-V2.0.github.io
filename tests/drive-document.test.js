import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeDriveDocumentUrl} from '../src/drive-document.js';

test('normaliza links de arquivo do Drive e Google Docs para uma URL canônica', () => {
  const id = 'DriveFile_A1234567';
  const expected = {driveFileId: id, driveUrl: `https://drive.google.com/file/d/${id}/view`};
  assert.deepEqual(normalizeDriveDocumentUrl(`https://drive.google.com/file/d/${id}/view?usp=sharing`), expected);
  assert.deepEqual(normalizeDriveDocumentUrl(`https://docs.google.com/document/d/${id}/edit`), expected);
  assert.deepEqual(normalizeDriveDocumentUrl(`https://drive.google.com/open?id=${id}`), expected);
});

test('recusa hosts, esquemas e IDs que não correspondem a um arquivo do Drive', () => {
  assert.throws(() => normalizeDriveDocumentUrl('https://example.com/file/d/DriveFile_A1234567/view'), /Google Drive/);
  assert.throws(() => normalizeDriveDocumentUrl('http://drive.google.com/file/d/DriveFile_A1234567/view'), /Google Drive/);
  assert.throws(() => normalizeDriveDocumentUrl('https://drive.google.com/file/d/short/view'), /identificar o arquivo/);
  assert.throws(() => normalizeDriveDocumentUrl('https://drive.google.com/folder/DriveFile_A1234567'), /identificar o arquivo/);
});
