# Revisão de FA e FB após as migrações

Inventário administrativo pontual de 23/10/2026, sem execução pelo Apps Script.

| Banco | Documentos principais encontrados | Removidos nesta revisão |
| --- | ---: | ---: |
| FA (`sahmt-17a16`) | 1.047 | 0 |
| FB (`sahmt-gestao-5ae66`) | 640 | 8 |

FA já passou pela retirada de 675 documentos de Gestão e Desempenho, registrada em `management-fa-retirement-2026-10-23.md`. O inventário atual não encontrou coleções de negócio desses módulos nem de QMENTUM/Ocorrências. Permanecem os módulos operacionais, 58 perfis, cadastros auxiliares e controles de corte. Os 120 registros de `operationalSheetArchives` são cópias de recuperação de edições e exclusões da planilha e continuam necessários.

Em FB foram removidos três documentos `evaluationSummaries` zerados de UIDs cuja exclusão havia sido autorizada e cinco documentos `documentAccessEmails` de contas já excluídas. A ausência das contas foi conferida no Authentication e nos 58 perfis atuais. Foram verificados ausência de descendentes, backup protegido com conferência de conteúdo, precondição de `updateTime` em cada exclusão e ausência posterior dos oito documentos.

As recuperações e os inventários ficam em `.local-preview/cleanup-20261023/`, fora do Git e da publicação. Os resumos restantes correspondem aos 58 perfis. Restam 58 concessões de documento.

Os cinco documentos legados em `documents`, os controles de publicação e os comprovantes de migração foram mantidos: o lote de expansão do leitor ainda está em 14/42, e o Organograma depende do cadastro antigo até sua finalização. Recibos de leitura expirados também preservam páginas já apresentadas para uma retomada; a expiração sozinha não os torna descartáveis. Registros entregues da outbox mantêm a prevenção de duplicação.

## Navegação e preparação do leitor

A PWA 236 leva um aviso de navegação, consumido uma única vez na mesma aba em até 30 segundos, ao trocar entre FA e FB. Esse aviso dispensa apenas a animação inicial. A autenticação e a validação de perfil continuam no fluxo habitual. Retornos de módulos hospedados em FA para Governança usam a mudança local de rota.

Em FB, o motor e o worker PDF são preparados em tempo ocioso após a sessão autenticada. Livros seguintes reutilizam o worker, enquanto cada documento é destruído ao fechar. A conversão do PDF recebido usa uma alocação direta. Isso reduz trabalho local e novas inicializações do leitor; o tempo do serviço de leitura precisa de medição autenticada após o retorno da cota do Apps Script.

Validação local: 51 testes de navegação, autenticação, acesso piloto, leitor e cache passaram; a regressão no navegador com PDF real passou, incluindo zoom móvel, mudança de páginas, conclusão e fechamento. Compilação de FA e FB conferida antes da publicação.
