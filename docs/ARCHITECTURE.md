# Arquitetura SAHMT V2.0

## Princípios

- Um PWA e um roteador SPA sob o base path do GitHub Pages.
- Uma instância Firebase Web (`sahmt-17a16`), um Firebase Auth e um Firestore `(default)`.
- Firestore é a fonte operacional online; IndexedDB guarda projeções locais e outbox para trabalho offline permitido.
- Módulos de UI chamam serviços de domínio. Nenhuma view fala diretamente com Sheets ou duplica autenticação.
- Firestore Rules verificam UID, status, papel e permissões por operação. O runtime operacional usa Firestore diretamente; a única exceção planejada é a callable `readLabelImage`, acionada explicitamente para leitura de etiquetas por IA. Ela depende de faturamento, segredo privado, App Check válido e deploy pelo proprietário e ainda não está ativa. Ações que podem ser verificadas com segurança são transações diretas Firestore + Rules; validações privilegiadas e integrações Google não bloqueantes usam Apps Script periódico com IAM mínimo e continuam fora da confirmação da ação no PWA.
- A UI permanece fiel à V1; refatoração de arquitetura não autoriza remoção de função ou redesenho.
- Velocidade do usuário vem de ações curtas no shell único, consultas delimitadas, cache de tela e confirmação de gravação Firestore; não de vários apps, logins, iframes ou idas ao Sheets.
- Módulos são domínios internos do mesmo PWA e da mesma sessão, sem instalações, serviços de autenticação ou service workers por módulo.

## Camadas

1. **App shell:** bootstrap, hash router, cabeçalho/retornos, lifecycle e acessibilidade.
2. **Auth/session:** Firebase Authentication comprova a identidade uma vez e mantém uma única sessão compartilhada pelas telas. Seu UID imutável é a chave de ligação a `users/{uid}`; uma leitura server-only pelo Firestore Lite resolve o perfil mínimo (`active`, `access`, `role`, `permissions`) antes de liberar a área protegida. A Home usa leituras Firestore Lite e cache IndexedDB; a contagem de ações pendentes consulta somente IndexedDB. O listener Firestore completo do perfil começa durante o próximo período ocioso (limite de 2,5 s; fallback de 1 s), para a primeira tela aparecer sem esperar o SDK de gravações. Serviços que exigem transação ou gravação carregam o SDK completo sob demanda. Identidade (Auth) e autorização (perfil + Firestore Rules) são responsabilidades distintas; as Rules verificam cada operação no servidor mesmo antes do listener. Nenhum módulo volta a autenticar, procurar a pessoa por e-mail em planilha ou chamar Apps Script para validar acesso. Perfil ausente, desativado ou sem acesso bloqueia operações protegidas; mudanças do perfil são observadas durante a sessão. O primeiro administrador foi provisionado manualmente pelo proprietário no Console Firebase em 26/09/2026; não há bootstrap privilegiado pelo cliente. UID, e-mail e nome conferem com Firebase Auth. Ver [`AUTHENTICATION_V2.md`](AUTHENTICATION_V2.md) para o contrato completo.
3. **Views:** Home/Escala, Operacional/Eventos, Etiquetas, Gestão, Checklist, Treinamentos, Administração e offline.
4. **Domínios:** escala, eventos/férias, catálogo de pagadores e credores de Eventos, labels, management/activities/scoring, documentos do Drive por área, inventário/eventos/manutenção de equipamentos dentro de Gestão, checklist, training, notifications e audit. Documentos guardam metadados versionados no Firestore e mantêm o arquivo no Drive; cada fluxo fica dentro do mesmo módulo e usa a mesma sessão.
5. **Data:** adaptadores Firestore com limites/paginação e conversão de Timestamp.
6. **Offline:** IndexedDB com schema versionado, cache de leitura com TTL, outbox, política de conflito e sincronização explícita.
7. **Integrações externas:** Apps Script V2 e a planilha de relatórios existente são consumidores assíncronos do Firestore, acionados por gatilhos periódicos. `SparkReportSync.gs` varre diretamente coleções e campos aprovados com cursores e upserts idempotentes; não precisa de produtor `syncQueue` nem de Cloud Functions. Validadores periódicos também processam pedidos de Checklist, claims de Treinamentos e decisões de pontuação de Gestão. O PWA confirma somente a transação Firestore e nunca espera por Apps Script/Sheets. Apps Script não autentica pessoas, não lê permissões para liberar sessão e não participa da autorização do cliente; como OAuth/IAM contorna Firestore Rules, o principal precisa de acesso mínimo e revisão independente. O código foi copiado e verificado no projeto Apps Script real; Drive e planilha estão restritos, mas IAM, autorização de runtime e homologação ainda precisam ser concluídos antes dos gatilhos.
8. **Deploy:** build estático, base `/SAHMT-V2.0.github.io/`, rules/indexes versionados, um service worker no escopo V2.

## Fluxo de escrita

Firebase Auth (prova de identidade) → UID → `users/{uid}` (perfil de autorização) → sessão única do PWA. As Firestore Rules revalidam o UID, o perfil e a permissão em cada operação protegida. A autenticação não importa, procura, migra nem espelha os dados operacionais da V1. A view chama o serviço de domínio; este acessa Firestore pelo SDK Web com validação de entrada, `uid`, `requestId`, versão e timestamps → Firestore Rules/transaction → confirmação visível. Offline permitido: mesma validação estrutural, persistência IndexedDB e outbox com ID idempotente; sincronizar depois e relatar conflito sem descartar alteração. O perfil local pode permitir abertura limitada durante indisponibilidade de rede, mas nunca substitui Rules na sincronização.

## Rotas planejadas

Hash routes para evitar fallback rewrite do Pages. `#/`, `#/eventos`, `#/etiquetas`, `#/gestao`, `#/checklist`, `#/treinamentos`, `#/admin`. A rota deve ser autorizada por módulo e manter destino/base path corretos ao abrir links e voltar.

## Dependências externas

O repositório usa `sahmt-17a16` e o Firestore `(default)` existente; não cria Firebase nem database alternativo. Rules e índices estão publicados; os módulos ainda precisam de homologação autenticada. A operação base permanece no Spark. A leitura de etiquetas por IA é a única exceção que requer Blaze, Secret Manager, App Check e deploy de `readLabelImage`; permanece inativa até decisão explícita do proprietário. A integração Sheets depende de restringir pasta/planilha, aprovar a projeção, revisar IAM, copiar e autorizar o Apps Script e homologar com dados fictícios. O trigger periódico de varredura direta só deve ser instalado após esses gates; nada disso pode atrasar ou substituir a confirmação operacional no Firestore.
