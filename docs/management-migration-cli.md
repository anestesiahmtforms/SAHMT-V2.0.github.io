# CLI e checkpoint privado da migração de Gestão

## Estado e limites desta entrega

Em **9 de outubro de 2026, na fase de preparação**, o acompanhamento registra **zero cópias reais de Gestão para FB**, zero importações de Auth e nenhuma ativação do módulo no app. O plano local possui **134 itens COPY** e **231 KEEP_FA**. A revisão desse plano e os ensaios sintéticos não são validação do banco atual ou de uma sessão real.

A origem é FA, `sahmt-17a16`. O destino de Gestão é FB, `sahmt-gestao-5ae66`, banco `(default)`. A PWA e seus produtores permanecem separados da autorização deste executor. A liberação do app exige direitos e identidade reconciliados, Auth de FB, produtores/integrador prontos, Rules apropriadas e validação humana do fluxo real. O comando de cópia não realiza esses passos.

## Revisão local histórica

No worktree isolado de Gestão:

~~~powershell
node scripts/management-migration.mjs --review
~~~

Esse modo abre os arquivos privados protegidos já existentes em `.local-preview/management-split`, verifica os hashes e recompõe o plano. Não carrega credenciais nem consulta Firestore, Auth ou Monitoring. O resumo omite documentos, e-mails, respostas privadas, gabaritos e tokens.

A revisão é **histórica**: utiliza os snapshots selecionados, o manifesto e o plano das capturas arquivadas e referenciadas no recibo privado v2; os carimbos dos arquivos usam UTC. O número 134 não significa que 134 documentos já estejam no destino. A revisão local tampouco torna o snapshot atual ou autoriza uma nova captura.

Se os backups privados não estiverem neste checkout ou não puderem ser abertos pelo mesmo usuário Windows, o modo falha. Esses arquivos não devem ser publicados no repositório. Nos testes, apenas a conferência que depende desses backups é ignorada quando os arquivos estão ausentes; entradas presentes continuam sujeitas a todos os hashes e verificações.

## Cópia com cápsula protegida

~~~powershell
node scripts/management-migration.mjs --copy capsule-NOME-APROVADO.dpapi.json
~~~

O argumento é somente o **nome do arquivo** em `.local-preview/management-split`. Não aceita caminho externo, traversal, arquivo plaintext, link simbólico ou diretório privado fora do checkout. Não reutilizar a cápsula sintética dos testes.

A cápsula deve ser protegida por Windows DPAPI e conter:

- `schemaVersion:1` e `kind:MANAGEMENT_MIGRATION_EXECUTION_CAPSULE`.
- Snapshots de origem e destino, manifesto privado e plano recomputável.
- Aprovação concreta com finalidade `MANAGEMENT_MIGRATION_CREATE_ONLY`, projetos FA/FB, banco `(default)`, request ID estável e prazo.
- Os seis pins: plano, snapshot de origem, manifesto, snapshot de destino, ACL e identidade.
- Pacotes reais de evidência fresca coletados pelo operador autorizado: capturas selecionadas de Firestore, Auth, ACL/identidades, metadados e Rules do destino e inventário dos produtores configurados.

Hashes comprovam integridade; não comprovam por si só autoridade, identidade ou disponibilidade da origem. Não preencher observações, produtor ausente, permissões ou `sourceStillMatchesBackup` com valores inventados. O coletor autorizado precisa fornecer os pacotes originais. O módulo de contexto valida esses pacotes sem fazer novas consultas.

A confirmação da origem e do destino exige cobertura completa do **escopo selecionado**, com os documentos ainda equivalentes aos snapshots revisados. Isso não certifica a cobertura global de todo o projeto. Alteração de documento, identidade, permissão ou público interrompe o trabalho e preserva os checkpoints.

O inventário precisa abranger os produtores configurados, incluindo Apps Script, cliente publicado, Functions e broker quando aplicável. A observação do registro configurado não certifica a inexistência global de produtores desconhecidos. Durante a cópia, o cliente FB permanece bloqueado e nenhum produtor escreve em FB.

## Prazo e orçamento

A aprovação tem janela máxima de quinze minutos. As evidências usadas pelo contexto têm frescor máximo de cinco minutos. A CLI atual fixa uma execução de até **três minutos**, incluindo a conferência final, limitada também pelo vencimento da aprovação. O menor prazo observado continua valendo; retry, nova métrica ou mudança do dia não prolongam essa janela.

A pausa diária de FA limita **novas leituras/capturas da origem**. Ela não impede a análise de backups locais nem impõe uma pausa ao orçamento de FB. Porém, se faltar uma captura atual de FA exigida pelo contexto, a cópia permanece bloqueada por essa evidência de origem.

FB utiliza a autorização independente `USER_AUTHORIZED_BOUNDED_FB_MIGRATION`, restrita à cópia de Gestão. Para o plano de 134 pares:

| Reserva local | Quantidade |
| --- | ---: |
| Leitura e commit create-only | 536 |
| Conferência final dos pares | 268 |
| Total máximo do run | 804 |

O consumo total de FB permanece desconhecido. Esses números não são medição faturável nem corte global do app. Monitoring e o antigo limite de 35.000 não são exigidos por esse modo. As reservas não autorizam FA, liberação de treinamentos, execução de gatilhos, créditos ou ativação de UI.

A CLI mantém `approval.approvedAt` original. Não cria automaticamente uma nova autoria/decisão humana ou substitui o request ID para estender a execução. A recuperação e a janela de treinamentos cancelados continuam encerradas.

## Credenciais e transportes

Plano, cápsula e contexto são validados antes de localizar a credencial de FB. A identidade do operador de destino é confirmada e o token permanece apenas no processo servidor. Credencial de FA não é usada como autenticação de FB. O frontend não recebe credenciais administrativas ou privadas.

A cópia usa apenas os pares aprovados de documento e proveniência. Cada `documents.commit` contém duas criações atômicas com `exists:false`. Não há overwrite, delete, reinício de job, reset de checkpoints, importação de Auth, concessão de créditos ou ativação de evaluation runtime.

O executor conserva IDs, relações, campos e histórico conforme o plano. A proveniência usa `migrationOrigins`. Documento e proveniência já existentes só são aceitos quando equivalentes e verificados. Conflito ou par parcial interrompe; não é completado automaticamente.

## Armazenamento privado e falhas

`scripts/lib/management-migration-private-store.js` guarda o orçamento e o checkpoint protegidos por AES-GCM com chave protegida por Windows DPAPI do usuário atual. Exige `.local-preview/` ignorado pelo Git, escopo/pins fixos e diretórios sem links.

O store é exclusivo por lock:

1. Persiste a reserva pendente antes de qualquer transporte.
2. Confirma o digest do registro efetivamente salvo.
3. Persiste a confirmação da reserva.
4. Só então o adaptador recebe a prova para a operação.

O store não permite alterar o run, os pins ou limites, devolver reservas, reduzir confirmação ou limpar uma pausa. Checkpoint de intenção precede o commit. Resposta incerta conserva a reserva e não provoca retry automático.

O POSTCHECK usa novas reservas, inclui o request ID de aprovação e revalida contexto/prova antes e depois de conferir os campos e a proveniência. Somente a verificação de todos os pares permite registrar conclusão.

Na falha, a CLI tenta persistir pausa e estado incompleto. O lock fica retido para revisão. Ele só é liberado após orçamento consumido e conferência completa de todos os pares. Não apagar o lock ou sobrescrever um run existente para continuar. Uma retomada exige revisão explícita do resultado conhecido/incerto, nova evidência fresca e novo plano/cápsula conforme o estado real.

O checkpoint cifrado é `migration-RUN_ID.dpapi.json`. O resumo local de resultado é `migration-result-RUN_ID.json`; ele contém somente contagens, hashes, fase e flags de auditoria. Falha ao registrar o resultado não confirma conclusão operacional.

## Disponibilização posterior

Mesmo um resultado `COMPLETE` confirma somente a cópia create-only e sua conferência no escopo do plano. Gestão no app continua dependente de:

- Identidades Google e vínculo UID FA/FB/membro reconciliados.
- Direitos do gestor e das exceções previamente definidas, com Rules e revogação consistentes.
- Sessão FB estabelecida pelo integrador confiável, preservando um login no app.
- Caminhos de Gestão no FB e consolidação de Desempenho em FA sem duplicar eventos migrados.
- Produtores e histórico auditados, seguidos de validação humana com usuário autenticado real.

Não interromper automaticamente os antigos produtores de FA, excluir fonte ou ativar botões com base apenas na cópia. A decisão de corte vem após essa validação.

## Testes locais

~~~powershell
node --test tests/management-migration-cli.test.js tests/management-migration-private-store.test.js
~~~

Os testes do store usam DPAPI real no Windows e somente dados sintéticos em diretórios temporários privados. Limpam apenas arquivos próprios e o diretório direto, sem remoção recursiva. A CLI é testada com argumentos recusados e cápsula sintética expirada antes de credenciais/rede. A conferência de 134/231 utiliza somente os backups privados locais quando presentes.

Testes locais, hashes, build e o modo review não substituem validação autenticada de Google/FB, permissão efetiva, negócio, pontuação, offline ou dispositivo real.

## Comandos reproduzíveis no CI

`npm run test:management` seleciona somente as suites locais de Gestão e três
dependências de backup/consolidação. DPAPI real e revisão dos backups privados
são específicas de Windows; a ausência de artefatos privados nunca é substituída
por dados de produção ou credenciais.

`npm run test:management-rules` usa `firebase.management.test.json`, projeto
`demo-sahmt-management-rules` e emulador `127.0.0.1:8187`. Os testes rejeitam outro
endpoint. Os dois comandos foram acrescentados ao CI do PR. O job de publicação
da PWA continua recusando eventos `pull_request`; executar estes testes não
invoca a CLI de cópia produtiva, publica Rules ou ativa Gestão em FB.