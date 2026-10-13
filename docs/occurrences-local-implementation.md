# Registro de Ocorrências

## Implementação

O módulo está integrado à PWA SAHMT V2. Na Home, o botão que antes aparecia como “Notificações de Eventos” agora abre “Registro de Ocorrências”. A flag `occurrences` controla a exibição; os módulos existentes mantêm suas próprias flags.

Profissionais com perfil FA ativo e acesso liberado podem enviar registros. Leitura da lista geral e auditoria permanecem em permissões separadas. O formulário oncológico continua indisponível enquanto sua definição não estiver aprovada. F10 não exibe a seção geral excluída pela especificação.

## Produção configurada em 12/10/2026

- O Gateway FA–FB–FC e o Worker de autenticação estão publicados.
- As identidades operacionais autorizadas foram provisionadas em FB e FC preservando seus UIDs FA. Contas previamente existentes foram mantidas.
- A coleção privada de catálogos foi instalada em FC.
- As regras de Ocorrências foram publicadas em FC; a leitura de `indicators` preserva o probe de leitura limitada.
- O perfil do administrador funcional recebeu permissões separadas para registrar, consultar e auditar ocorrências.
- A flag global `appConfig/app.features.occurrences` foi criada no FA e habilitada. As demais flags foram preservadas e ESG/Inovação continuam desligados.
- As regras FA receberam somente suporte compatível à flag e às três chaves de permissão de Ocorrências; a publicação foi confirmada após uma indisponibilidade temporária do deploy CLI.

## Dados e pontos

Relatório, autoria interna e reivindicação idempotente de dois pontos são gravados numa transação FC. Os registros de pontuação ficam em `PENDING_VALIDATION`; ainda não existe reconciliação autoritativa com Desempenho/FB, portanto os pontos não são creditados automaticamente.

O módulo não guarda rascunhos localmente. Uma resposta de sucesso só é mostrada após confirmação do Firestore. Até o momento, a leitura autenticada da coleção e das regras foi verificada; ainda falta confirmar um envio real de ocorrência por um usuário final.

## Verificações

Os testes locais cobrem contrato do formulário, regras, integração FA–FB–FC e o cartão da Home. A publicação do código PWA depende do workflow GitHub Pages; a publicação do Gateway, Worker e regras Firebase é separada.
