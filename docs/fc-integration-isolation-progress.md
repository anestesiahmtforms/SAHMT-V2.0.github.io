# Progresso — isolamento FC

Data: 01/11/2026, America/Sao_Paulo. Publicação e corte do Desempenho FC autorizados; execução em andamento.
Plano: `docs/superpowers/plans/2026-11-01-fc-integration-isolation.md`.
Base: `5bd3b44`; branch local `codex/fc-integration-isolation`; preparação inicial em `cbb0354`.

## Código e validação

- Login automático atual mapeado: sessões Firebase próprias por projeto, restauração persistente, mesmas UIDs com validação separada de audiência/provedor/permissões. Coordenador preservado.
- Roteamento das três rotas FC preparado, desabilitado por padrão. Operações de planilhas FA preservadas. Worker FC exige backend próprio e reaproveita autorização, relays, recibos e admissão existentes.
- Primeira revisão independente apontou CI e sucessos via entrypoint; ambos corrigidos. Suíte direcionada anterior: 215 testes aprovados; build completo PWA aprovado somente localmente com origem FC fictícia.
- Nova camada Apps Script FC em `apps-script-fc/`: Entry (três ações, conta executora e script esperado), Setup (dono interativo, configuração desativada, ACL do OCR) e PrepareDrive (cópias nativas idempotentes com trava exclusiva e organização do novo projeto).
- Revisão seguinte identificou que DriveApp.Access.PRIVATE não exclui compartilhamento nominal. Corrigido com inspeção das permissões, recusando usuários/grupos/domínio adicionais; leitura de ACL indisponível impede instalação. Testes registraram as falhas antes da correção.
- Verificação atual específica: 38 testes aprovados (22 Apps Script FC + 10 isolamento + 6 comparação de implantação). Fluxo de preparação Drive testado com limites externos controlados, repetição sem novas cópias e preflight integral antes de mutações; diagnóstico de erro verifica ausência de tokens/conteúdo bruto em logs. Instalação confere propriedades após gravação; status público comprova executor/script sem revelar identidade ou segredos. Ainda não é validação integrada real do PWA.
- Pacote derivado da versão 55: parsing, ausência de globais duplicados e início desativado verificados; snapshot e pacote armazenados com DPAPI. Readback cloud do conteúdo enviado confirmado.

## Cloudflare real

- Perfil FC `sahmt-fc-isolation` protegido pelo Windows; conta e identidade verificadas: `57b8b02c577b6f61e96a61ce44142d2e`, `anestesiahmtforms3@gmail.com`. Perfil central preservado.
- Plano Workers Free/$0 confirmado pelo painel e pelo usuário. Nenhuma assinatura, pagamento, cartão, upgrade ou recurso pago habilitado.
- `sahmt-fc-integration` criado após inventário vazio; primeira versão `80d0c9f1-2ae2-4481-bc4e-91407c4b82b8`, namespace SQLite `0db752efd43943838b3af89e0eabeafc` preservado.
- Versão atual `6d988179-8254-446b-8832-a7da78b9b468`, URL `https://sahmt-fc-integration.anestesiahmtforms3.workers.dev`, backend FC próprio configurado. Workers.dev habilitado, previews desativados, três flags false, segredos preservados, nenhum agendamento. Nove probes HTTP reais passaram (três bloqueios 503, três preflights 204, duas rotas recusadas 404 e origem indevida 403). Endpoint é público, mas as operações continuam desativadas.

## Google real

- Autorizações FA e FC concluídas pelo fluxo oficial clasp e protegidas com DPAPI; identidade de cada conta verificada antes de persistir. Escopos readonly da primeira tentativa foram bloqueados pelo cliente padrão; a tentativa com escopos padrão de Apps Script funcionou. Exportador FA restringe suas operações a GET.
- Exportados os 79 arquivos centrais, quatro implantações e conteúdos publicados das versões 45, 54 e 55. Worker central aponta para 55; contrato FC analisado nessa versão. Fonte central não modificada.
- Pasta destino `1HKohx4MezyQC4tW2gim11ar_7OfmFtPc` é propriedade da conta FC. Seu compartilhamento por link permanece; criada subpasta com herança desativada `1hc8nHWMXAUbyU3TsmD_5TzBdJdNa5I5A` e subpastas privadas de técnicas, indicadores, OCR e entrada.
- API Apps Script inicialmente desativada em FC; usuário ativou e criação funcionou. Novo projeto `1rwJgnVjEmCoSfXlhIA-SNaCFOINIl_-O73CVn9D_aIBM60tI_qZnUtrI`, título SAHMT V2.0 – FC – Integração Spark, criadora confirmada `anestesiahmtforms3@gmail.com`.
- Execução real organizarRecursosFcV1 concluída às 16:18:29: FC_DRIVE_PREPARED, 20 cópias, firestoreWrites=0. Relatório Drive `1zIBhSsfF-TJP9kBsFmylGs-vnDLQv9R2` pertence a FC. Readback independente confirmou projeto na subpasta restrita, propriedade FC dos 20 arquivos finais e todos os checksums. Originais e cópias de entrada preservados.
- Segredos próprios por par preparados: dois valores aleatórios independentes de 32 bytes, protegidos localmente por DPAPI, escritos no Worker FC via stdin sem arquivo/argumento em texto claro. API confirmou nomes secret_text e flags desativadas; valores Worker serão validados por troca HMAC integrada, pois não são retornados pela API.
- prepararIntegracaoFcV1 executada pela dona às 16:23:29: configurationVerified=true, enabled=false, triggers=0 e businessWrites=0. Fingerprints conferidos com os valores protegidos. Bootstrap temporário com literais removido do código e readback confirmado; segredos permanecem nas propriedades e no armazenamento protegido.
- Implantação FC própria versão 1 criada pela conta FC: `AKfycbypyEIHiUM7Ouh1NT9djsnTPWbPiyPHv-BiEYZdyoKcqrgOEwiQFUq2i3O03DzddnjdDg`. GET real confirmou FC_INTEGRATION_STATUS, enabled=false, executorVerified=true e scriptVerified=true. Executa como USER_DEPLOYING; zero gatilhos e nenhum encaminhamento PWA alterado.
- Tentativa de copiar pelo OAuth FC foi recusada com appNotAuthorizedToFile, apesar de metadados legíveis. Preparação usa execução normal do Apps Script pela dona para concluir as cópias dentro do Google Drive. Originais não alterados e nenhum download externo realizado.
- Revisão automática recusou downloads por URLs intermediárias e criação de pasta na raiz FA; ambas não executadas. Caminho de download removido. Uma consulta posterior falhou por indisponibilidade de créditos da revisão automática; a mesma consulta foi retomada pelo fluxo normal e concluída sem contornar a revisão.
- Conta FC lê configurações QMENTUM e occurrenceRuntime/independentV1 no Firestore FC (marcador ACTIVE). Consultas de marcadores de pontuação FA/FB retornaram 403. Não foram concedidas permissões novas nesses projetos.
- Sessão administrativa FA ampliada por autorização do usuário e verificada; operações continuam de leitura. Confirmados FB independentFbCutover ACTIVE (fb-independent-20261022-v1) e evaluationRuntime/state com occurrenceScoringApproved=true. Marcadores antigos de consolidação FA retornam 404. API Firebase de metadados retorna SERVICE_DISABLED no cliente OAuth; não habilitada como tentativa de contorno.
- Dependências de ciclo horário, participação QMENTUM e recuperação de Ocorrências mapeadas separadamente em fc-source-dependencies-with-jobs.json. São 124 declarações; nenhuma automação adicional foi instalada. O ciclo trimestral depende de prova de camada gratuita Gemini e chave/modelo atuais; não criar billing nem inventar essa prova.
- Leitura do PWA publicado confirmou HTTP 200 e asset app-CztzxL0d.js com o Worker central sahmt-auth-broker.anestesiahmtforms.workers.dev. Nenhuma publicação PWA foi feita neste trabalho.
- Controle do navegador ainda responde Local browser use is disabled in Work settings. Login, ativação da API e consentimento runtime dependem da interação do usuário; trabalho administrativo acessível segue por API.

## Desempenho FC exclusivo — decisão e preparação atual

- Usuário definiu pontuação exclusiva em FC e escolheu somente novas ações após a ativação. A proposta anterior de acesso do executor FC ao ledger FB está SUPERADA; não conceder esse IAM nem criar sincronização automática.
- Código local completo: tela Registros → Desempenho FC, repositório de leitura por UID com sessão FC existente, regras acrescentadas sem remover as anteriores, núcleo de pontuação com destino FC fixo e marco temporal, recibos idempotentes e recuperação com filas limitadas e cursores rotativos.
- Firestore real: billingEnabled=false pela API, 58 membros aprovados, duas configurações novas verificadas e desativadas, cinco índices READY. Nenhum lançamento/saldo foi criado ou importado. Filas de Ocorrências, participações e revisões estavam vazias no inventário.
- Pacote Apps Script protegido: 24 arquivos/145 declarações; sete testes do pacote exato aprovados. Após aprovação explícita “autorizado”, versão 2 publicada e confirmada desativada, com executor/script corretos e modo FC_ONLY. A dona executou prepararDesempenhoFcV1 às 17:41:21, comprovando acesso real, zero gatilhos e zero pontos importados. A recusa inicial de revisão foi resolvida pela aprovação; não houve contorno.
- Patch central enviado e lido de volta: guardas em oito funções FC de quatro arquivos e diagnóstico sem UrlFetch. Outros arquivos existentes e as quatro implantações foram preservados. Flags e acionadores ainda não foram alterados.
- Diagnóstico central executado pela dona às 17:46:56: modo de corte e marco ausentes, pontuação de Ocorrências true, trimestral QMENTUM ausente. Identificados 20 acionadores de operação, formulários, reconciliação e Checklist; não apagar esses acionadores compartilhados. A parada FC usa guardas/propriedades restritas.
- Build completo local FA/FB/enquetes aprovado. Testes de autenticação, contratos e navegação aprovados. Regras verificadas em emulador; a validação integrada no ambiente real continua pendente de publicação/ativação autorizada.
- Plano concreto de liberação e reversão aprovado: `docs/fc-performance-release-2026-11-01.md`. Workflow habilita a publicação do novo módulo; as três rotas HTTP FC do piloto continuam com flag independente false até seus próprios testes de transição.

## Próximo passo imediato e pendências

1. Confirmar o caminho de publicação pelo GitHub Desktop autenticado. Não há credencial GitHub na CLI. Foi adicionada somente a cópia local pwa desta tarefa; a outra cópia com três alterações do usuário permanece preservada. Ainda não publicar em main antes da prontidão do servidor.
2. Executar a parada central autorizada, aguardar drenagem, preparar marco FC, publicar regras, ativar um único acionador FC e publicar o PWA. A quota central anterior não será limpa ou contornada. A IA trimestral permanece desativada até comprovação atual de camada gratuita.
3. Plano local de referências preparado em fc-reference-transition-plan.json a partir de nova leitura do documento atual. Contém só folders.TECHNIQUES/INDICATORS, precondição updateTime e inverso condicionado ao readback do corte. executable=false, executed=false; compatibilidade de ambos os executores e clientes antigos precisa ser comprovada. Nenhum patch aplicado; não migrar dados de negócio Firestore.
4. Validar login/sessões, permissões, operações, arquivos, recibos, cache, outras quatro estações e reversão pelo PWA. Somente após evidências concretas solicitar aprovação para o corte, como exigido no pedido original.

Falha anterior de leitura às 16:10:36 não voltou a ocorrer na execução integral de 16:17–16:18. Diagnóstico confirmou driveScopeGranted=true; a causa exata da primeira recusa não foi comprovada. Não registrar uma causa presumida nem declarar migração integrada concluída.

Não executar scripts existentes de consolidação/migração Firestore: estão fora do escopo do isolamento.
