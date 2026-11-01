# Progresso — isolamento FC

Data: 01/11/2026, America/Sao_Paulo. Migração em preparação; nenhum corte em produção.
Plano: `docs/superpowers/plans/2026-11-01-fc-integration-isolation.md`.
Base: `5bd3b44`; branch local `codex/fc-integration-isolation`; preparação inicial em `cbb0354`.

## Código e validação

- Login automático atual mapeado: sessões Firebase próprias por projeto, restauração persistente, mesmas UIDs com validação separada de audiência/provedor/permissões. Coordenador preservado.
- Roteamento das três rotas FC preparado, desabilitado por padrão. Operações de planilhas FA preservadas. Worker FC exige backend próprio e reaproveita autorização, relays, recibos e admissão existentes.
- Primeira revisão independente apontou CI e sucessos via entrypoint; ambos corrigidos. Suíte direcionada anterior: 215 testes aprovados; build completo PWA aprovado somente localmente com origem FC fictícia.
- Nova camada Apps Script FC em `apps-script-fc/`: Entry (três ações, conta executora e script esperado), Setup (dono interativo, configuração desativada, ACL do OCR) e PrepareDrive (cópias nativas idempotentes com trava exclusiva e organização do novo projeto).
- Revisão seguinte identificou que DriveApp.Access.PRIVATE não exclui compartilhamento nominal. Corrigido com inspeção das permissões, recusando usuários/grupos/domínio adicionais; leitura de ACL indisponível impede instalação. Testes registraram as falhas antes da correção.
- Verificação atual específica: 34 testes aprovados (18 Apps Script FC + 10 isolamento + 6 comparação de implantação). Fluxo completo de preparação Drive testado com limites externos controlados, repetição sem novas cópias e preflight integral antes de mutações. Ainda não é validação integrada real do PWA.
- Pacote derivado da versão 55: parsing, ausência de globais duplicados e início desativado verificados; snapshot e pacote armazenados com DPAPI. Readback cloud do conteúdo enviado confirmado.

## Cloudflare real

- Perfil FC `sahmt-fc-isolation` protegido pelo Windows; conta e identidade verificadas: `57b8b02c577b6f61e96a61ce44142d2e`, `anestesiahmtforms3@gmail.com`. Perfil central preservado.
- Plano Workers Free/$0 confirmado pelo painel e pelo usuário. Nenhuma assinatura, pagamento, cartão, upgrade ou recurso pago habilitado.
- `sahmt-fc-integration` criado após inventário vazio; versão `80d0c9f1-2ae2-4481-bc4e-91407c4b82b8`, namespace SQLite `0db752efd43943838b3af89e0eabeafc`.
- Workers.dev e previews desativados, três flags false e nenhum agendamento. Sem endpoint público operacional validado.

## Google real

- Autorizações FA e FC concluídas pelo fluxo oficial clasp e protegidas com DPAPI; identidade de cada conta verificada antes de persistir. Escopos readonly da primeira tentativa foram bloqueados pelo cliente padrão; a tentativa com escopos padrão de Apps Script funcionou. Exportador FA restringe suas operações a GET.
- Exportados os 79 arquivos centrais, quatro implantações e conteúdos publicados das versões 45, 54 e 55. Worker central aponta para 55; contrato FC analisado nessa versão. Fonte central não modificada.
- Pasta destino `1HKohx4MezyQC4tW2gim11ar_7OfmFtPc` é propriedade da conta FC. Seu compartilhamento por link permanece; criada subpasta com herança desativada `1hc8nHWMXAUbyU3TsmD_5TzBdJdNa5I5A` e subpastas privadas de técnicas, indicadores, OCR e entrada.
- API Apps Script inicialmente desativada em FC; usuário ativou e criação funcionou. Novo projeto `1rwJgnVjEmCoSfXlhIA-SNaCFOINIl_-O73CVn9D_aIBM60tI_qZnUtrI`, título SAHMT V2.0 – FC – Integração Spark, criadora confirmada `anestesiahmtforms3@gmail.com`.
- Enviados 22 arquivos de preparação ao novo projeto, com readback confirmado. Sem segredos administrativos, implantação pública, gatilhos ou ativação. Movimento para a pasta restrita e identidade executora runtime aguardam a função manual organizarRecursosFcV1.
- Cópias Drive nativas: 20 imagens copiadas de FA para a subpasta de entrada FC, com metadados/permissões/checksums verificados. As cópias de entrada ainda pertencem a FA. Cópias finais com propriedade FC aguardam a execução pela conta dona; não confundir localização no Drive FC com propriedade migrada.
- Tentativa de copiar pelo OAuth FC foi recusada com appNotAuthorizedToFile, apesar de metadados legíveis. Preparação usa execução normal do Apps Script pela dona para concluir as cópias dentro do Google Drive. Originais não alterados e nenhum download externo realizado.
- Revisão automática recusou downloads por URLs intermediárias e criação de pasta na raiz FA; ambas não executadas. Caminho de download removido. Uma consulta posterior falhou por indisponibilidade de créditos da revisão automática; a mesma consulta foi retomada pelo fluxo normal e concluída sem contornar a revisão.
- Conta FC lê configurações QMENTUM e occurrenceRuntime/independentV1 no Firestore FC (marcador ACTIVE). Consultas de marcadores de pontuação FA/FB retornaram 403. Não foram concedidas permissões novas nesses projetos.
- Controle do navegador ainda responde Local browser use is disabled in Work settings. Login, ativação da API e consentimento runtime dependem da interação do usuário; trabalho administrativo acessível segue por API.

## Próximo passo imediato e pendências

1. Usuário executar organizarRecursosFcV1 no novo editor com a conta FC. A função verifica a conta, propriedade/ACL, todos os 20 fingerprints, organiza apenas o novo projeto, cria cópias FC com IDs rastreáveis e salva recibo sem segredos na entrada FC. Não altera Firestore ou produção.
2. Ler o recibo pelo Drive conectado, verificar os IDs/checksums/propriedade finais e completar o mapa. Preservar originais e cópias de entrada.
3. Concluir inventário real de propriedades e gatilhos centrais, roteamento ativo do ledger e acesso mínimo necessário ao executor FC. Preparar segredos por par e configuração privada apenas após verificar privacidade do projeto.
4. Preparar patches restritos de referências QMENTUM com updateTime e inversos; nenhum patch foi aplicado. Não copiar/mover/apagar dados de negócio Firestore.
5. Validar login/sessões, permissões, operações, arquivos, recibos, cache, outras quatro estações e reversão pelo PWA. Somente após evidências concretas solicitar aprovação para o corte, como exigido no pedido original.

Não executar scripts existentes de consolidação/migração Firestore: estão fora do escopo do isolamento.
