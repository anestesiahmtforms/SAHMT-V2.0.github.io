# Diretrizes: plano de implementação

Execução direta autorizada pelo usuário, sem nova rodada de revisão documental.

**Objetivo:** leitor PDF no app e liberação individual de Forms após conclusão, desativados até homologação.
**Especificação:** ../specs/2026-10-17-diretrizes-leitura-individual-design.md
**Arquitetura:** PWA → Worker (validação Firebase FA e admissão) → Apps Script (HMAC, perfil, catálogo, sessões e concessão). PDF.js local renderiza bytes privados recebidos pelo mesmo canal. Firestore FA guarda comprovantes escritos somente pelo servidor.

## Restrições

- Sem publicação, mudança de permissões reais ou concessões de pontuação nesta execução.
- Sem novos leases FB/FC, segredos públicos, escopos adicionais automáticos ou faturamento.
- Política privada deve conter vínculos confirmados entre catálogo, PDF, checksum, páginas e formulário. Não inventar identificadores.
- PDF limitado a 6 MiB e 300 páginas; recusar excedentes explicitamente. Sessão de 2 horas; progresso acumulado enviado na conclusão, não por segundo.
- A política permanece registrada mesmo com execução desativada, impedindo que publicadores antigos contornem o bloqueio.

## Etapas e arquivos

1. Testes de protocolo e backend com mocks: `tests/diretrizes-reading.test.js`, `tests/diretrizes-reading-relay.test.js`, `tests/diretrizes-reading-backend.test.js`. Cobrir usuário divergente, token rejeitado, replay, versão, sessão expirada, concessão incompleta e repetida.
2. Implementar `worker-management-auth/diretrizes-reading-relay.js` e rota `/v1/diretrizes/reading` em `worker.js`: origem permitida, admissão, token FA verificado por Google, HMAC e resposta limitada. Nenhum token é enviado ao Apps Script.
3. Implementar `apps-script-v2/DiretrizesReading.gs`: política privada, correspondência de identidade, arquivo imutável por checksum, sessão persistida, progresso, concessão individual e leitura de permissões. Integrar `OperationalSheetPush.gs` e guarda em `FormsEvaluation.gs`. Fechar o formulário em divergência de audiência, sem apagar direitos técnicos.
4. Implementar `src/diretrizes-reading.js` e `src/diretrizes-ebook.js`: transporte sem logs, invalidação na troca de usuário, PDF.js com worker empacotado, páginas renderizadas sequencialmente, retomada de sessão e conclusão explícita. Integrar cartão e inicialização em `src/main.js`, estilos isolados.
5. Documentar propriedades, catálogo privado, preparação da transição e reversão em `apps-script-v2/DIRETRIZES_READING.md`. Não instalar propriedades ou retirar acessos remotamente.
6. Executar testes focados, regressões de material/catálogo/Worker, verificação de sintaxe Apps Script, build e check FA. Registrar limites e dependências da homologação real.

## Revisão de falhas

- Página oculta não conta como apresentada; informação de cliente continua sendo evidência de etapa e não prova de compreensão.
- Conta Google de outro projeto, e-mail não verificado e token revogado recusados.
- PDFs grandes, cifrados ou inconsistentes não liberam formulário.
- Duplicação, concorrência e atraso preservam o comprovante sem conceder acesso a outra identidade.
- Publicadores legados e mudança de versão não reabrem audiência ampla.

## Publicação posterior

Exige catálogo real confirmado, grant de executor já autorizado, transição controlada dos respondentes e teste com conta participante (não proprietário). Não afirmar bloqueio de link direto em produção antes dessa prova.
