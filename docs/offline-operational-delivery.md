# Continuidade offline — entrega local de 19/10/2026

## Estado

Implementação na branch `codex/offline-operational-modules`, em worktree isolada. Nenhuma publicação, consulta ao Firebase real, alteração de usuários, Rules, IAM ou faturamento foi realizada nesta etapa. A PWA pública não recebeu este pacote.

## Funcionamento preparado

| Recurso | Operação local |
| --- | --- |
| Abertura | Service Worker entrega primeiro o HTML e os recursos da versão instalada. A atualização instala outro conjunto versionado. |
| Sessão | Restaura Firebase Auth e perfil anteriormente validado, dentro da validade local; a consulta remota não bloqueia essa apresentação. Primeiro acesso e sessão ausente exigem conexão. |
| Escala | Escala do dia, contatos, férias e diretório já sincronizados. Eventos pendentes do mesmo usuário aparecem na visão local da escala e do rodízio, sem alterar a cópia confirmada. |
| Eventos | Formulário, catálogos, registro local, edição permitida e relatórios dos períodos armazenados. |
| Etiquetas | Registro Manual, rascunho, registro local, correção com versão base e relatórios armazenados. A leitura por IA continua dependente da rede. |
| Checklist | Cadastro dos 28 arsenais, inativos, manutenção previamente armazenada, respostas locais e relatórios armazenados. Biblioteca QR incluída nos recursos locais; câmera depende das permissões e do aparelho. |
| Conferência | Pode guardar uma intenção local quando escala e verificações locais estão completas. Reabrir e confirmar online é necessário para a conferência oficial e pontuação; datas anteriores precisam de revisão administrativa. |
| Pendências | IndexedDB por UID, identificador estável, confirmação explícita de envio, revalidação de permissões e tratamento de conflitos. Não são apagadas pelo logout, limpeza de cache ou atualização do shell. |

As permissões existentes permanecem aplicáveis. Perfil ausente, expirado, bloqueado ou divergente não concede acesso. Recusa de permissão não é tratada como simples falta de rede.

## Desempenho e consumo

- Cache é apresentado antes da revalidação das leituras essenciais. Chamadas iguais simultâneas compartilham a mesma operação.
- Leituras coordenadas e listeners sem confirmação têm prazo de 7 segundos. O prazo não cancela uma operação já recebida pelo SDK/servidor; por isso a fila conserva o identificador e faz conciliação idempotente.
- Quota esgotada suspende novas tentativas coordenadas por pelo menos 5 minutos, com espera crescente e jitter. Um sucesso atrasado de outra chamada não cancela essa pausa.
- A fila não rearma temporizadores em repetição imediata quando o backend está suspenso. Após 8 falhas, uma ação exige revisão/tentativa explícita.
- A preparação aproveita dados já salvos, carrega somente os conjuntos essenciais autorizados e reutiliza o pré-carregamento dos relatórios diários. Não varre históricos nem prepara todos os meses automaticamente.
- Contadores locais representam apenas chamadas coordenadas e documentos recebidos, nunca a medição oficial de cobrança.

## Persistência e limites

- Banco operacional `sahmt-v2-local`, versão 4: perfis, cache, outbox e rascunhos separados. Migração preserva registros anteriores.
- Firestore mantém a inicialização existente com `memoryLocalCache`. A persistência operacional e de reenvio é feita explicitamente em IndexedDB; não foi criada outra instância concorrente do Firestore.
- Perfil local: validade existente de 24 horas. Cache de Etiquetas: 24 horas. Outros caches operacionais: 7 dias. Rascunhos e operações pendentes não têm descarte por esses prazos.
- A preparação limpa somente o cache de leitura, priorizando catálogos, com referência de 240 entradas e 8 MiB estimados. Isso não representa o consumo exato em disco. Progresso de treinamento não enviado é preservado.
- Sem uma cópia previamente preparada, os dados ausentes são identificados; não são inventados. Relatórios mensais offline dependem do mês ter sido armazenado.
- Campos em preenchimento são preservados por identidade/módulo. Limpeza após envio é vinculada ao formulário submetido e sua revisão; sincronização antiga não apaga um rascunho novo.

## iPhone / Safari

A tela Sincronização informa a prontidão de cada módulo, a persistência concedida e o uso local estimado. O botão **Preparar uso offline** solicita `navigator.storage.persist()` quando suportado. Falha/ausência dessa API não bloqueia a interface.

Depois da futura publicação: abrir no Safari, adicionar à Tela de Início e preparar os dados dentro desse app instalado, com a conta correta e conexão disponível. Não usar janela privada nem limpar os dados do site com pendências.

Safari e o app instalado podem ter armazenamentos distintos. A persistência é uma decisão do navegador; a instalação é um dos critérios usados pelo WebKit. Pressão de armazenamento e limpeza pelo usuário/sistema podem remover os dados locais. Não há garantia absoluta de retenção nem sincronização com a PWA completamente fechada. Referência: [política oficial de armazenamento do WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/).

Não foi realizada validação em iPhone físico ou Safari/WebKit nesta etapa. O teste automatizado usa Chromium com viewport móvel; não comprova câmera ou comportamento real do iOS.

## Verificação reproduzível

Executar somente testes sintéticos locais:

```text
npm run test:offline-operational
npm run test:domain
npm run build -- --configLoader runner
npm run test:offline-browser
```

O cliente de navegador usa o build real, Service Worker, Firebase SDK e IndexedDB, com identidade fictícia. Intercepta/bloqueia toda requisição externa: não possui autorização para consultar produção. Simula HTTP 429 e queda de rede, verifica rascunho após reabrir, registro manual, relatórios, 28 arsenais, intenção local e sobrevivência da fila.

Evidências locais: `.local-preview/domain-tests.log`, `.local-preview/offline-tests.log`, `.local-preview/build.log` e `.local-preview/offline-browser-report.json`. Esses arquivos são ignorados pelo Git.

O build mantém avisos conhecidos sobre imports estáticos/dinâmicos e um chunk Firebase maior que 500 kB. São avisos, não erros de compilação.

### Resultado desta execução

- Domínio: **1.003 aprovados**, nenhuma falha.
- Continuidade operacional offline: **123 aprovados**, nenhuma falha. Há sobreposição entre as duas suítes; as contagens não representam testes exclusivos somados.
- Build completo aprovado com o carregador de configuração `runner`.
- Navegador: **12 cenários aprovados**, incluindo relatórios diário/mensal de Eventos, Etiquetas e Checklist; rascunho; registro manual; conferência local sem pontuação; persistência após reabrir; HTTP 429 sintético com internet.
- Firebase de produção: **0 leituras e 0 gravações**. Duas chamadas Firestore foram interceptadas e respondidas localmente; outra requisição externa foi bloqueada.
- Tempos observados apenas nesta simulação Chromium: reabertura até Etiquetas **3.601 ms**; navegação e abertura do formulário Eventos **171 ms**; relatório Checklist **147 ms**. São medições locais, sem comparação anterior controlada e sem garantia de tempo no iPhone.
- A revisão independente identificou riscos em limpeza de rascunhos, troca de identidade e logout com progresso pendente. Os casos foram corrigidos e receberam testes de regressão. Não foi concluída uma segunda revisão independente integral.

Arquivos principais: `src/auth.js`, `src/data-lite.js`, `src/data.js`, `src/main.js`, `src/outbox.js`, `src/offline-cache.js`, `src/record-write.js`, `src/report-pending.js`, `public/service-worker.js`; novos serviços `firebase-failure`, `operational-backend`, `report-deadline`, `offline-mutation`, `offline-form-drafts`, `offline-preparation`, `offline-readiness`, `offline-runtime-mode`, `offline-report-cache`, `offline-outbox-policy`, `offline-checklist-conference` e `offline-schedule-overlay` em `src/`. Os testes e o cliente `scripts/test-offline-operational-browser.mjs` acompanham o pacote. `package.json` contém os comandos de validação.

## Publicação e reversão futuras

O pacote ainda precisa ser integrado ao branch de publicação com preservação das alterações paralelas e autorização de publicação. A validação no iPhone ocorre após instalar a versão aprovada, preparar os dados online e testar modo avião e retomada.

Reverter para uma versão antiga que só conhece IndexedDB v3 pode impedir esse código antigo de abrir o banco v4. A reversão deve conservar suporte de leitura à versão 4 e os dados pendentes; não apagar IndexedDB, outbox ou rascunhos para forçar uma reversão. Exportar/reconciliar pendências antes de qualquer manutenção de armazenamento.
