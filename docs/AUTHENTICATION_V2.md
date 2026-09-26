# Autenticação e autorização SAHMT V2.0

## Propósito

A autenticação V2 tem um único propósito: estabelecer a identidade da pessoa e manter uma sessão única no PWA. Firebase Authentication comprova essa identidade. O UID estável identifica o perfil de acesso SAHMT em `users/{uid}`; esse perfil e as Firestore Rules determinam o que a identidade pode ler ou alterar. Não é uma migração do cadastro ou do modelo de dados operacional da V1.

## Caminho único

1. A pessoa autentica uma vez pelo provedor habilitado no Firebase existente.
2. Firebase Auth fornece a identidade e o UID imutável.
3. A V2 lê `users/{uid}` para obter somente o perfil SAHMT e as permissões. Se não houver perfil ativo provisionado para aquele UID, a área protegida permanece bloqueada e o acesso precisa ser provisionado por um administrador.
4. O shell mantém a mesma sessão ao navegar. Os serviços da aplicação executam ações diretamente no Firestore.
5. Firestore Rules conferem UID, estado do perfil e permissão em cada leitura/gravação protegida.

Na inicialização online, a leitura de `users/{uid}` usa Firestore Lite, que busca do servidor e não habilita cache/offline por conta própria. Com o perfil válido, a V2 mostra o shell e carrega o SDK Firestore completo para observar mudanças do perfil e operar os módulos. Se a leitura online falhar por falta de conexão, somente o perfil local recente permite a abertura offline limitada; as Rules continuam decidindo cada gravação sincronizada.

Firebase Auth é inicializado com persistência local em IndexedDB e fallback de persistência do navegador. A configuração usa `initializeAuth` sem preparar o resolvedor de pop-up na abertura; `browserPopupRedirectResolver` só é passado ao fluxo quando a pessoa toca no botão. Isso evita o pré-carregamento do iframe de autenticação em dispositivos móveis. O login continua em pop-up; redirect exigiria as opções de domínio/hosting descritas pelo Firebase para funcionar de forma confiável em navegadores com bloqueio de cookies de terceiros.

Perfil ausente, inativo ou sem acesso bloqueia a área protegida. E-mail coincidente não substitui UID. O cliente não pode se provisionar, mudar as próprias permissões ou conceder privilégio. O primeiro administrador precisa de um provisionamento manual e controlado no Console; depois disso, Administração da V2 gerencia os demais perfis. Consulte [`FIRST_ADMIN_BOOTSTRAP.md`](FIRST_ADMIN_BOOTSTRAP.md) para o procedimento e o esquema exato.

## Fora do propósito da autenticação

- Não consultar usuários, e-mails ou permissões em Sheets para autenticar ou autorizar.
- Não enviar token de sessão a Apps Script ou a uma planilha por ação.
- Não criar login separado por módulo, credencial local, nova instância Firebase ou sessão paralela.
- Não misturar o documento `users/{uid}` com contatos, cadastro legado ou entidades operacionais.
- Apps Script e Sheets não são dependência do login, da sessão, da autorização, da navegação nem da confirmação operacional no Firestore.
- Ação online termina quando Firestore confirma. Offline permitido é estado pendente local até Rules aceitarem a sincronização.

Não há modelo de dados de autenticação em planilha. A integração administrativa prevista pode espelhar dados operacionais autorizados depois da confirmação no Firestore; nunca consulta ou espelha `users`, permissões ou credenciais e não altera este fluxo de autenticação.

## Estado de verificação

O cliente V2 usa o Firebase existente `sahmt-17a16` e observa o documento de perfil durante a sessão. Em leitura somente de consulta ao Console Firebase em 25/09/2026, Google apareceu como provedor ativado; Email/Senha não apareceu como provedor ativado. Nenhuma configuração de provedor foi alterada. Em 25/09/2026, o login Google na V2 publicada chegou ao estado `profile-missing` e exibiu o UID com a ação “Copiar UID”; isso confirma a resolução da identidade pelo Auth, mas não o acesso ao shell ou a operações Firestore. O documento inicial `users/{uid}` ainda precisa ser provisionado pelo proprietário conforme [`FIRST_ADMIN_BOOTSTRAP.md`](FIRST_ADMIN_BOOTSTRAP.md). A homologação UID→perfil, leituras, gravações e sincronização offline continua pendente.
