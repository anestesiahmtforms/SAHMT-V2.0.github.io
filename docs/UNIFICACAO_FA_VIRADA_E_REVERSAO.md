# Execução e recuperação de Gestão/Desempenho

Autorização administrativa concedida em 15/10/2026. O banco de origem deve ser preservado. Nenhum reset, exclusão da origem, alteração IAM ou billing é necessário.

## Ordem de execução

1. `npm run prepare:fa-consolidation`: sintaxe Apps Script, testes da cópia/segurança, domínio, gestão, domínio secundário e build. Relatório agregado em `artifacts/fa-consolidation/preparation.json`. O relatório local não declara produção pronta.
2. Inventário tipado e privado com ponto de leitura único; simulação e restauração conferida. Confirmar Rules publicadas, índices, perfis e métricas. As ferramentas `fa-consolidation-*audit`, `*preflight` e `*usage` são de leitura.
3. Prévia `node scripts/fa-consolidation-stage.mjs <stamp>`. O modo sem `--apply` não faz alterações. Exigir zero drift do Apps Script em relação à base revisada `828ad33`.
4. Preparar publicação da PWA em branch isolado, sem substituir produção antes dos demais gates. Não incorporar alterações não revisadas das outras worktrees.
5. `node scripts/fa-consolidation-stage.mjs <stamp> --apply`: backup privado de fonte/deployments/controles; bloquear clientes antigos pelos marcadores já contemplados nas Rules; atualizar somente oito arquivos Apps Script, preservando os outros 17 e o manifesto; versionar deployments existentes, mantendo URLs. Qualquer erro interrompe sem retries.
6. Aguardar sete minutos a partir da última atualização, para encerramento de execuções anteriores (limite normal Apps Script de seis minutos). Os gatilhos seguem a fonte salva; deployments versionados também são atualizados.
7. Atualizar métricas. `node scripts/fa-consolidation-apply.mjs --apply`, com emulador exclusivamente loopback disponível: conferir barreiras e hash do backend, capturar delta final, restaurar a cópia final no emulador, verificar faturamento e margem de cotas, aplicar somente CREATE/SKIP com precondições e checkpoints privados. Não copiar Authentication ou perfis.
8. Só gerar ACTIVE se o código de conclusão for VERIFIED, com hash do plano e todas as operações verificadas. Reabrir domínio FA; FB continua bloqueado para esses módulos, com dados conservados.
9. Publicar build correspondente com Gestão/Desempenho fixos FA e sessão FB desativada; atualizar service worker. Conferir conteúdo servido, login FA e fluxo autenticado real. Ocorrências permanece FC nesta etapa; sua pontuação destina-se FA.

## Falhas e reversão

- Antes da primeira cópia: fonte, versões e controles anteriores ficam no journal DPAPI. Pode-se restituir a fonte integral original e os números anteriores dos deployments; conferir readback. Nenhum arquivo privado deve ser reconstituído no Git.
- Cópia parcial: manter os dois lados bloqueados, conservar checkpoint e reler os documentos. Nunca reenviar cegamente commit com resultado desconhecido; documentos já equivalentes são reconhecidos. Não ativar FA com resultado PARTIAL.
- Depois da ativação: bloquear escritores, guardar snapshot do FA e reconciliar novos registros/recibos/ajustes produzidos após a virada antes de reabrir FB. Não restaurar snapshot antigo sobre dados novos nem simplesmente voltar a versão antiga da PWA.
- A ativação do backend precede a liberação da interface; erro de publicação não autoriza voltar a gravar em FB sem conferir se o FA já recebeu novas gravações.
- Pendências offline antigas continuam guardadas e bloqueadas para conciliação. Não limpar armazenamento dos dispositivos como procedimento de reversão.

## Evidências separadas

Registrar testes locais, snapshot final, quantidade copiada, verificação pós-cópia, versão backend, publicação Pages e teste autenticado. Um build/HTTP 200 não comprova o último item.
