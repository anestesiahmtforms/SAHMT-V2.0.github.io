import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {googleMaterialPreview, renderMaterialViewerTrigger} from '../src/material-viewer.js';
import {renderManagementDocumentCard} from '../src/management-document-folders.js';

test('Google Docs, Sheets and Slides use transient PDF previews with canonical Drive fallback links', () => {
  assert.deepEqual(googleMaterialPreview('https://docs.google.com/document/d/DocFile_123456789/edit?usp=sharing'), {
    previewUrl: 'https://docs.google.com/document/d/DocFile_123456789/export?format=pdf',
    openUrl: 'https://docs.google.com/document/d/DocFile_123456789/edit'
  });
  assert.equal(googleMaterialPreview('https://docs.google.com/spreadsheets/d/SheetFile_123456789/edit').previewUrl,
    'https://docs.google.com/spreadsheets/d/SheetFile_123456789/export?format=pdf');
  assert.equal(googleMaterialPreview('https://docs.google.com/presentation/d/SlideFile_123456789/edit').previewUrl,
    'https://docs.google.com/presentation/d/SlideFile_123456789/export/pdf');
});

test('Drive file previews stay inside Google preview without storing or downloading a copy', () => {
  assert.deepEqual(googleMaterialPreview(' https://drive.google.com/file/d/DriveFile_123456789/view?usp=drive_link\n '), {
    previewUrl: 'https://drive.google.com/file/d/DriveFile_123456789/preview',
    openUrl: 'https://drive.google.com/file/d/DriveFile_123456789/view'
  });
  assert.equal(googleMaterialPreview('https://drive.google.com/open?id=DriveFile_123456789').previewUrl,
    'https://drive.google.com/file/d/DriveFile_123456789/preview');
});

test('only supported HTTPS Google Drive materials are embedded', () => {
  for (const value of [
    '', 'http://drive.google.com/file/d/DriveFile_123456789/view',
    'https://drive.google.com.evil.invalid/file/d/DriveFile_123456789/view',
    'https://user:pass@drive.google.com/file/d/DriveFile_123456789/view',
    'https://example.invalid/file/d/DriveFile_123456789/view',
    'https://docs.google.com/forms/d/FormFile_123456789/viewform',
    'https://drive.google.com/file/d/short/view'
  ]) assert.equal(googleMaterialPreview(value), null, value);
});

test('viewer trigger escapes labels and only carries canonical Google preview destinations', () => {
  const markup = renderMaterialViewerTrigger('https://drive.google.com/file/d/DriveFile_123456789/view', {
    label: 'Material & apoio', title: '<Guia>'
  });
  assert.match(markup, /^<button class="material-viewer-trigger" type="button" data-open-material-viewer/);
  assert.ok(markup.includes('data-material-url="https://drive.google.com/file/d/DriveFile_123456789/preview"'));
  assert.match(markup, /data-material-title="&lt;Guia&gt;"/);
  assert.match(markup, /Material &amp; apoio/);
  assert.doesNotMatch(markup, /target="_blank"/);
  assert.equal(renderMaterialViewerTrigger('https://example.invalid/x'), '');
});

test('Gestão, Desempenho e Treinamentos route Google Drive materials to the in-app viewer', async () => {
  const [main, performance, training, css] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/performance-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/training.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(main, /installMaterialViewer\(document\)/);
  assert.match(performance, /renderMaterialViewerTrigger\(url/);
  assert.match(training, /renderMaterialViewerTrigger\(activity\.resourceUrl/);
  assert.match(css, /\.material-viewer-dialog\[open\]\{display:grid;grid-template-rows:auto auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.material-viewer-dialog__body iframe\{display:block;width:100%;height:100%/);
});

test('Gestão de documentos mantém o card premium e abre um arquivo Drive no painel interno', () => {
  const markup = renderManagementDocumentCard({id: 'doc', title: 'Protocolo sintético', category: 'Protocolos',
    driveUrl: 'https://drive.google.com/file/d/DriveFile_123456789/view'});
  assert.match(markup, /<button class="management-document-link management-document-premium"/);
  assert.match(markup, /data-open-material-viewer/);
  assert.match(markup, /data-material-title="Protocolo sintético"/);
  assert.doesNotMatch(markup, /target="_blank"/);
});
