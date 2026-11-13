const messages={
  'permission-denied':'O servidor recusou a leitura da escala. O acesso precisa ser conferido pela administração.',
  MODULE_ACCESS_DENIED:'A sessão não foi autorizada para acessar a escala. Confira o acesso pela entrada do SAHMT.',
  MODULE_SESSION_TIMEOUT:'A confirmação de acesso à escala demorou além do esperado. Tente novamente.',
  'resource-exhausted':'O serviço da escala atingiu o limite de consultas. Aguarde antes de tentar novamente.',
  'online-required':'Confirme a conexão do app com o servidor antes de tentar novamente.'
};
const allowed=new Set([...Object.keys(messages),'MODULE_SESSION_UNAVAILABLE','MODULE_SESSION_INVALID','MODULE_BROKER_RESPONSE_INVALID',
  'MODULE_AUTH_NETWORK','MODULE_AUTH_INVALID_TOKEN','MODULE_AUTH_PROJECT_MISMATCH','MODULE_AUTH_USER_DISABLED',
  'MODULE_AUTH_THROTTLED','MODULE_AUTH_DISABLED','MODULE_SOURCE_SESSION_CHANGED','MODULE_SESSION_INACTIVE',
  'unavailable','deadline-exceeded','network-request-failed','unauthenticated','failed-precondition']);
export function scheduleReadFailure(error){
  const candidate=String(error?.code||'').replace(/^firestore\//,'');
  const code=allowed.has(candidate)?candidate:'READ_FAILED';
  const phase=['source-token','exchange','target-login','claims'].includes(error?.phase)?error.phase:'';
  return {message:messages[code]||'Não foi possível carregar a escala agora.',reference:'FJ · '+code+(phase?' · '+phase:'')};
}
