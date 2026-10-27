# Pesquisa de clima — publicação gratuita no FE / FA

Instrumento baseado no [Google Doc institucional, versão 1.0](https://docs.google.com/document/d/1dtn8JSzE3QYG4ZZQBAxtRCAKfEBnyJE7z599OBo2sKE/edit). É autoral, não oficial ou validado Qmentum.

## Endereços e arquitetura

- Formulário: https://outros-48120.web.app/
- Painel agregado: https://outros-48120.web.app/dashboard.html
- FA: Governança → Enquetes e Consultas → PESQUISA DE CLIMA ORGANIZACIONAL.
- FE: projeto `outros-48120`, banco Firestore **padrão existente**, Firebase Hosting. Sem Cloud Functions, banco adicional, serviços de processamento ou migração para Blaze.
- FA: projeto `sahmt-17a16`, app publicado pelo processo GitHub Pages existente. `VITE_CLIMATE_SURVEY_ENABLED=true` habilita o link na compilação. O menu abre para usuários ativos e aprovados; os demais módulos preservam as permissões existentes. A versão do cache foi atualizada para v264.

O formulário não exige login e não importa Firebase Auth, Analytics ou código de sessão do FA. Envia um commit REST diretamente ao Firestore, com `credentials: omit` e `no-referrer`. As regras Firebase são a validação de segurança, independente do JavaScript. O painel usa autenticação FE separada, persistida somente em memória.

Os 32 itens comuns, 8 dimensões, 3 módulos condicionais de 5 itens e 5 comentários opcionais seguem o documento mestre. Perfil é opcional e não é persistido como campo, mas o módulo escolhido pode indicar a função. Consentimento é necessário na interface; permite-se branco e N/A, com pelo menos um item comum numérico.

## Armazenamento e acesso

- `climateResponses/{token}`: somente `survey_cycle`, `survey_version` e `answers`.
- `climateComments/{outroToken}`: somente `survey_cycle` e `comments`.
- `climateCycles/{ciclo}`: configuração administrativa de abertura/fechamento, sem leitura ou escrita pelo cliente.
- `climateReports/{ciclo}`: snapshot final agregado, sem escrita cliente.
- `climateActionReports/{ciclo}`: indicadores de andamento das ações, sem dados individuais.

As regras permitem criação pública somente durante o ciclo aberto, com IDs aleatórios de 128 bits, campos exatos, itens conhecidos, respostas entre 1–5 ou NA, um único módulo e textos limitados. Rejeitam campos de nome, e-mail, UID, IP, horários e perfil. Comentários ainda podem conter identificadores digitados por uma pessoa: precisam de revisão antes de compartilhamento.

Leitura e exclusão dos dados individuais são negadas a todos os clientes, inclusive leitores do painel. Atualização é permitida apenas quando o conteúdo é **exatamente igual** ao já armazenado, para reenvio após falha. Troca de respostas, inclusão de campos e exclusão são negadas. Respostas e comentários são gravados atomicamente, com tokens diferentes, mantidos só na memória da página. Ambos os tokens permanecem iguais no reenvio.

Somente tokens FE com a claim `climateReportReader: true` podem ler relatórios. Foi autorizada a conta proprietária `anestesiahmtforms5@gmail.com`. Não se atribuem permissões com base em parâmetro de URL, identidade transferida do FA ou informações no formulário. Uma nova entrada no Google atualiza o token após alteração da claim.

As regras anteriores de `userCategories` e `userCategoryDefinitions` foram preservadas na base auditada `firestore.fe.base.rules`. O gerador adiciona apenas os escopos da pesquisa antes do bloqueio geral. Antes de futuros deployments, comparar essa base com as regras FE atuais e reconciliar alterações de outros módulos. A configuração `.firebaserc` continua apontando para FA; sempre fixar `--project outros-48120 --account anestesiahmtforms5@gmail.com --config firebase.climate.json` ao publicar FE.

## Limites reais de anonimato e do plano gratuito

Não há promessa de anonimato absoluto. O código não coloca nome, e-mail, UID ou IP nos documentos analíticos, mas hospedagem, Firestore, autenticação do menu/painel e infraestrutura podem produzir registros técnicos, IP e horários. A gravação atômica conserva metadados de criação/atualização: administradores privilegiados podem correlacionar comentários e respostas apesar dos IDs diferentes. IAM e acesso administrativo precisam de controle, pois acesso por OAuth administrativo ignora as regras dos clientes.

A auditoria de 27/10/2026 encontrou o FE sem faturamento, Google habilitado, domínio `outros-48120.web.app` autorizado, sem site anterior publicado, sem sinks externos de logs e sem exclusões configuradas. Os buckets padrão retêm logs gerais por 30 dias e auditoria obrigatória por 400 dias. Isso não prova que todos os serviços deixem de registrar IP. Esses logs não foram apagados nem a retenção foi alterada. Não se consultaram respostas reais na auditoria.

Não há garantia de uma resposta por pessoa nem verificação de elegibilidade: recarregar ou abrir outro navegador permite novo envio. O reenvio na mesma página mantém o mesmo conteúdo. A adesão é estimada por envios/60, pode superar 100% e não representa participantes únicos confirmados. A coleta pública pode sofrer spam e esgotar a cota gratuita compartilhada do Firestore. O plano Spark limita o serviço por quota; não foi vinculada conta de cobrança. Monitorar uso e disponibilidade durante o ciclo.

Não publicar comentários literais ou detalhados, módulos administrativos isolados ou resultados individuais. Designar custodiante dos dados brutos, revisão/desidentificação de textos e prazo institucional de retenção/descarte, incluindo cópias e backups. Nenhuma exclusão automática de dados institucionais está configurada.

## Agregação

Consolidação somente após fechamento, com criação de um snapshot imutável por ciclo. Sem atualização em tempo real ou filtros por função. N/A e branco ficam fora do denominador. Cada item precisa de pelo menos 5 respondentes numéricos; complementos entre 1–4 também suprimem o resultado. Se qualquer item falhar, seu composto/dimensão é suprimido. Os módulos de residentes e preceptores têm proteção de complementos e da diferença para o total. O módulo administrativo nunca é publicado.

O painel mostra adesão estimada, favorabilidade geral e por dimensão, segurança psicológica, cultura de segurança, intenção de contribuição, confiança no ciclo de melhoria, módulos elegíveis e indicadores das ações. Ciclos anteriores publicados permanecem visíveis para comparação. Um novo ciclo exige atualização editorial deliberada de `climate-domain/schema.js` e recompilação das regras e páginas, preservando snapshots antigos.

## Operação

Instalar dependências do repositório. Node 22 e Java 21 são os runtimes da integração contínua.

```powershell
npm ci
npm run build:climate
npm run test:climate
npm run test:climate-rules
firebase deploy --project outros-48120 --account anestesiahmtforms5@gmail.com --config firebase.climate.json --only firestore,hosting
```

O script administrativo usa a conta FE já conectada no Firebase CLI. Não grava token ou chave de serviço no código, no HTML ou na URL. Os comandos a seguir alteram exclusivamente coleções da pesquisa no FE:

```powershell
node scripts/climate-admin.mjs status
node scripts/climate-admin.mjs open
node scripts/climate-admin.mjs close
node scripts/climate-admin.mjs publish
```

`open` cria o documento apenas se não existir; não reabre ciclo fechado. `publish` exige fechamento, proteção mínima de amostra e cria o relatório apenas se ainda não existir. Não sobrescrever ou publicar recortes sucessivos que permitam dedução por diferenças. O ciclo 2026 foi autorizado para abertura pelo usuário nesta implantação.

Para atualizar I15/I16, preparar um JSON aprovado de contagens, por exemplo `{"due":5,"completedOnTime":4,"reevaluated":3,"effective":2}`, e executar `node scripts/climate-admin.mjs actions arquivo.json`. Denominador zero fica sem percentual. O plano detalhado 5W2H/PDSA pertence ao processo institucional de governança, fora das respostas.

## Validação e recuo

Validação local: testes gerais do app, testes específicos do instrumento/cálculo/anonimato, navegador em 320/390/768/1440 px, regras no emulador oficial, lote atômico, reenvio idêntico, alteração e identificação bloqueadas, ciclo fechado, leitura negada a visitantes e separação entre painel e dados brutos. O Astra revisou regras e supressão de grupos. A publicação foi integrada à versão v263 já existente, preservando suas correções de acesso, conexão e navegação.

Fechar o ciclo interrompe novos envios. Desabilitar a flag na próxima compilação FA remove o link. Preservar os dados sob acesso restrito; não excluir bancos ou logs automaticamente em um recuo.
