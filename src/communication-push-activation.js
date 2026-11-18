export function activateCommunicationPush(client, browser) {
  const {Notification: systemNotifications, navigator} = browser || {};
  if (!systemNotifications || !navigator?.serviceWorker) {
    return Promise.reject(Object.assign(Error('COMM_PUSH_UNSUPPORTED'), {code: 'COMM_PUSH_UNSUPPORTED'}));
  }
  const permission = systemNotifications.permission;
  return client.enable(permission === 'default' ? systemNotifications.requestPermission() : Promise.resolve(permission));
}

export function pushActivationMessage(error) {
  switch (error?.code) {
    case 'COMM_PUSH_PERMISSION': return 'Permita as notificações do SAHMT nos ajustes do aparelho.';
    case 'COMM_PUSH_UNSUPPORTED': return 'No iPhone, abra o SAHMT pelo ícone da Tela de Início para ativar as notificações.';
    case 'COMM_SESSION_INVALID': return 'Confirme sua conta Google no SAHMT e tente ativar novamente.';
    case 'COMM_DEVICE_LIMIT': return 'O limite de aparelhos com notificações foi atingido.';
    default: return 'Não foi possível registrar este aparelho. Tente novamente.';
  }
}
