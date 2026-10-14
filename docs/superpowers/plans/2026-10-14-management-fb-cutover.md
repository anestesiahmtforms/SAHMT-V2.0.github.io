# Migração definitiva de Gestão e Treinamentos para FB

**Autorização:** pedido explícito de 14/10/2026 para migrar os treinamentos e todo o módulo Gestão para FB e retirar os dados correspondentes de FA. Treinamentos pontuados ainda não foram liberados à equipe. Preservar identidade FA, módulos operacionais, histórico e Spark sem billing.

**Arquitetura:** reutilizar o app FB, broker, sessões independentes, gateway IAM e os capturadores já existentes. A cópia anterior não é o corte operacional: o destino local pode ser selecionado explicitamente; a produção ainda não recebeu o corte desta continuação. A exclusão depende da troca efetiva dos consumidores e de comparação atualizada, não apenas de contagens antigas.

## Entregas e ordem

- [x] Identificar origem efetiva do catálogo, progresso e validação; conferir recibo anterior (47 documentos, sendo 4 treinamentos).
- [x] Conferir FA por leitura: 4 treinamentos, 1 progresso, 1 recibo e 1 conclusão; guardar captura privada fora do Git.
- [x] Renovar a sessão do proprietário FB e capturar as árvores atuais, incluindo subcoleções e documentos órfãos. Captura completa: 181 documentos em cada projeto.
- [x] Produzir comparação por documento com tipos Firestore preservados, hash, ausência/equivalência/conflito. Todos os 181 documentos são equivalentes; nenhuma ausência ou divergência. A análise dos consumidores e dependências continua necessária para exclusão.
- [x] Atualizar inventário de identidades: 61 contas FA, inicialmente 60 FB. Criada exclusivamente a identidade ausente com o UID FA. Conferência posterior: 61 correspondências exatas de UID e e-mail; nenhuma conta existente alterada.
- [x] Conferir liberação comum: 54 perfis ativos elegíveis já possuem managementRead e trainingsRead. Três perfis protegidos preservados, um perfil inativo preservado e duas identidades antigas de homologação fora da liberação operacional. Uma conta nova ainda não possui perfil FA correspondente aprovado. Nenhuma escrita de perfil foi necessária.
- [x] Preparar localmente o encaminhamento exclusivo das operações Gestão/Treinamentos da PWA ao FB, com sessão do mesmo UID, falha fechada e caches/fila isolados por destino. Não usar FA como fallback após o corte.
- [ ] Ajustar autorização, consumidores Apps Script e permissões FB sem substituir o executor global FA; preservar a conferência/pontuação de Checklist no FA.
- [ ] Adaptar referências compartilhadas (auditoria, notificações por área, avaliação consolidada e grupos de documentos) para que a remoção não quebre outras funcionalidades.
- [ ] Copiar somente diferenças autorizadas com pré-condições; conferir tipos, IDs, vínculos e versão depois da escrita; habilitar consumidores após testes.
- [ ] Congelar escritores antigos do domínio, fazer reconciliação final, validar leitura/gravação FB e só então excluir caminhos FA exatos com precondição de updateTime e backup conferido.
- [ ] Registrar resultado, rotas efetivas e restauração; não apagar fontes Drive, usuários FA, operacional ou histórico não migrado.

## Controle de exclusão

O executor não deve aceitar uma lista livre de coleções para apagar. Cada caminho precisa pertencer ao domínio aprovado, estar no backup completo, ter destino equivalente ou transformação explícita revisada, não ter escritores FA ativos e manter o updateTime conferido. Conflito, sessão expirada, snapshot parcial ou referência compartilhada não resolvida bloqueiam somente a fase dependente.

## Limites de evidência

949 testes e build aprovados nesta data se referem à alteração do Checklist, não à migração. A sessão FB estava expirada na primeira conferência e a renovação foi iniciada. A implantação e a comparação FA/FB serão registradas somente após resultados reais.

## Evidências confirmadas em 14/10/2026

- Checklist v190: build/deploy GitHub Actions concluídos com sucesso; assets públicos e proteções de arsenais/rodízio conferidos.
- A falsa indicação posterior de sessão FB expirada vinha do cache global de token da Firebase CLI, que reutilizava a primeira identidade em um processo com duas contas. A captura agora isola cada proprietário em um worker local e verifica a identidade OAuth antes de consultar o respectivo projeto.
- Capturas completas e comparação armazenadas fora do repositório, em LOCALAPPDATA/SAHMT/management-cutover. Identidades, prévia e recibo de aplicação em LOCALAPPDATA/SAHMT/management-user-release. Segredos OAuth nunca são persistidos nesses arquivos.
- Planejador de acesso: 12 testes locais aprovados, incluindo descarte de hashes/tokens, conflito de UID/e-mail, preservação de contas existentes/inativas/protegidas e alterações limitadas às duas permissões comuns.
- Worker publicado: autenticação FB/FC habilitada; modo restrito ao piloto desabilitado e ausência de binding de allowlist do piloto confirmados por leitura da versão implantada. Primeiro login especial permanece desligado.
- A criação da identidade ausente usa importação sem sobrescrita, sem senhas, sem claims administrativos e sem copiar credenciais Google. Login principal permanece FA.
- Estes resultados não certificam que o módulo inteiro já opera no FB. As rotas e regras locais foram ampliadas nesta continuação. A dependência dos comunicados por área no FA permanece; não houve exclusão de dados FA nem publicação da migração.

## Continuação local validada

Gateway com contexto de áreas/grupos, Worker com ativação independente, PWA com destinos/caches/fila separados, regras candidatas completas e pontuação consolidada preparados. O comando de preparação terminou PASS; detalhes, contagens e limites de evidência estão em `docs/secondary-scoring-progress-20261014.md`.

As autorizações remotas existentes não foram reconsultadas nesta continuação. `managementAreas` e `auditLogs` no FA constam explicitamente como exclusões proibidas no pacote local, enquanto houver uso compartilhado. Dados e filas anteriores permanecem preservados.
