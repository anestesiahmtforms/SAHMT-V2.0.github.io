const WHATSAPP_URL = /^https:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?phone=\d+)$/;

export function contactActionLinks(contact = {}) {
  const phone = String(contact.phone || '').replace(/\D/g, '');
  const storedWhatsApp = WHATSAPP_URL.test(String(contact.whatsAppLink || ''))
    ? String(contact.whatsAppLink)
    : '';
  const nationalNumber = phone.startsWith('55') && [12, 13].includes(phone.length)
    ? phone.slice(2)
    : phone.startsWith('0') && [11, 12].includes(phone.length)
      ? phone.slice(1)
      : [10, 11].includes(phone.length)
        ? phone
        : '';

  return {
    phone,
    email: String(contact.email || '').trim(),
    whatsApp: storedWhatsApp || (nationalNumber ? `https://wa.me/55${nationalNumber}` : '')
  };
}
