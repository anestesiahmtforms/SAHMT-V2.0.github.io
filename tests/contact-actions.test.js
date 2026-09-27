import test from 'node:test';
import assert from 'node:assert/strict';
import {contactActionLinks} from '../src/contact-actions.js';

test('usa link de WhatsApp cadastrado e mantém telefone e e-mail para suas ações', () => {
  assert.deepEqual(contactActionLinks({
    phone: '+55 (11) 99999-0000',
    email: ' pessoa@example.com ',
    whatsAppLink: 'https://wa.me/5511988887777'
  }), {
    phone: '5511999990000',
    email: 'pessoa@example.com',
    whatsApp: 'https://wa.me/5511988887777'
  });
});

test('cria atalho brasileiro de WhatsApp pelo telefone quando falta link cadastrado', () => {
  assert.equal(contactActionLinks({phone: '(11) 99999-0000'}).whatsApp, 'https://wa.me/5511999990000');
  assert.equal(contactActionLinks({phone: '011 3333-0000'}).whatsApp, 'https://wa.me/551133330000');
  assert.equal(contactActionLinks({phone: '+55 21 98888-7777'}).whatsApp, 'https://wa.me/5521988887777');
});

test('não monta links de WhatsApp com telefones incompletos nem aceita links fora da lista permitida', () => {
  assert.equal(contactActionLinks({phone: '12345', whatsAppLink: 'javascript:alert(1)'}).whatsApp, '');
});
