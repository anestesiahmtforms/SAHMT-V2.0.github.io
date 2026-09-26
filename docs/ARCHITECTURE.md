# Arquitetura SAHMT V2.0

## Princípios

- Um PWA e um roteador SPA sob o base path do GitHub Pages.
- Uma instância Firebase Web (`sahmt-17a16`), um Firebase Auth e um Firestore `(default)`.
- Firestore é a fonte operacional online; IndexedDB guarda projeções locais e outbox para trabalho offline permitido.
- Módulos de UI chamam serviços de domínio. Nenhuma view fala diretamente com Sheets ou duplica autenticação.
- Firestore Rules verificam UID, status, papel e permissões por operação. Funções server-side são usadas apenas para chaves privadas, validações privilegiadas, integrações Google e tarefas que não podem ser confiadas ao cliente.
- A UI permanece fiel à V1; refatoração de arquitetura não autoriza remoção de função ou redesenho.
- Velocidade do usuário vem de ações curtas no shell único, consultas delimitadas, cache de tela e confirmação de gravação Firestore; não de vários apps, logins, iframes ou idas ao Sheets.
- Módulos são domínios internos do mesmo PWA e da mesma sessão, sem instalações, serviços de autenticação ou service workers por módulo.

## Camadas

1. **App shell:** bootstrap, hash router, cabeçalho/retornos, lifecycle e acessibilidade.
2. **Auth/session:** Firebase Authentication comprova a identidade uma vez e mantém uma única sessão compartilhada pelas telas. Seu UID imutável é a chave de ligação a `users/{uid}`; uma leitura server-only pelo Firestore Lite resolve o perfil mínimo (`active`, `access`, `role`, `permissions`) antes de liberar a área protegida. A Home usa leituras Firestore Lite e cache IndexedDB; a contagem de ações pendentes consulta somente IndexedDB. O listener Firestore completo do perfil começa durante o próximo período ocioso (limite de 2,5 s; fallback de 1 s), para a primeira tela aparecer sem esperar o SDK de gravações. Serviços que exigem transação ou gravação carregam o SDK completo sob demanda. Identidade (Auth) e autorização (perfil + Firestore Rules) são responsabilidades distintas; as Rules verificam cada operação no servidor mesmo antes do listener. Nenhum módulo volta a autenticar, procurar a pessoa por e-mail em planilha ou chamar Apps Script para validar acesso. Perfil ausente, desativado ou sem acesso bloqueia operações protegidas; mudanças do perfil são observadas durante a sessão. O primeiro administrador requer ação controlada do proprietário no Console Firebase, sem bootstrap privilegiado pelo cliente. Ver [`AUTHENTICATION_V2.md`](AUTHENTICATION_V2.md) para o contrato completo.
3. **Views:** Home/Escala, Operacional/Eventos, Etiquetas, Gestão, Checklist, Treinamentos, Administração e offline.
4. **Domínios:** escala, eventos/férias, catálogo de pagadores e credores de Eventos, labels, management/activities/scoring, documentos do Drive por área, inventário/eventos/manutenção de equipamentos dentro de Gestão, checklist, training, notifications e audit. Documentos guardam metadados versionados no Firestore e mantêm o arquivo no Drive; cada fluxo fica dentro do mesmo módulo e usa a mesma sessão.
5. **Data:** adaptadores Firestore com limites/paginação e conversão de Timestamp.
6. **Offline:** IndexedDB com schema versionado, cache de leitura com TTL, outbox, política de conflito e sincronização explícita.
7. **Integrações externas:** Apps Script V2 e uma nova planilha são uma camada assíncrona de relatório/auditoria alimentada pelo Firestore. Uma fila `syncQueue` deve ser criada no servidor após gravações autorizadas; Apps Script aplica upserts idempotentes nas abas aprovadas. O PWA nunca espera por Sheets e não chama Apps Script por ação. Apps Script não autentica pessoas, não lê `users`/permissões e não participa da autorização Firebase. O espelhamento ainda não está implantado: planilha, projeção de campos, identidade de integração e acesso seguro precisam ser configurados e validados.
8. **Deploy:** build estático, base `/SAHMT-V2.0.github.io/`, rules/indexes versionados, um service worker no escopo V2.

## Fluxo de escrita

Firebase Auth (prova de identidade) → UID → `users/{uid}` (perfil de autorização) → sessão única do PWA. As Firestore Rules revalidam o UID, o perfil e a permissão em cada operação protegida. A autenticação não importa, procura, migra nem espelha os dados operacionais da V1. A view chama o serviço de domínio; este acessa Firestore pelo SDK Web com validação de entrada, `uid`, `requestId`, versão e timestamps → Firestore Rules/transaction → confirmação visível. Offline permitido: mesma validação estrutural, persistência IndexedDB e outbox com ID idempotente; sincronizar depois e relatar conflito sem descartar alteração. O perfil local pode permitir abertura limitada durante indisponibilidade de rede, mas nunca substitui Rules na sincronização.

## Rotas planejadas

Hash routes para evitar fallback rewrite do Pages. `#/`, `#/eventos`, `#/etiquetas`, `#/gestao`, `#/checklist`, `#/treinamentos`, `#/admin`. A rota deve ser autorizada por módulo e manter destino/base path corretos ao abrir links e voltar.

## Dependências externas

O repositório já identifica `sahmt-17a16`; esta construção não cria Firebase. A existência do Firestore `(default)`, provedores Auth, rules, índices e autorizações de conta precisa ser verificada antes de ligar operações de produção. O espelhamento para Sheets depende de preparar a planilha nova na pasta oficial, decidir a lista de campos por aba, provisionar o acesso da integração e implantar as Functions de fila; nada disso pode atrasar ou substituir a confirmação operacional no Firestore.
