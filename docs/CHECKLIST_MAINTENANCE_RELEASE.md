# Checklist: calendários de manutenção — 01/10/2026

## Escopo

Base: `57e4df0a8760378fe66d78c9dd691b6380c3dd77`, main do SAHMT V2. Checkout isolado; as três alterações locais da pasta FIRESTORE original foram preservadas.

O banner usa três calendários: **Preventiva Anual**, **Elétrica Anual** e **Calibração Semestral**. O administrador abre **Editar Manutenção**, escolhe as datas e salva. Campos vazios removem a programação correspondente. Datas futuras permanecem como cadastradas; não há reagendamento automático.

Uma data anterior ao dia atual em São Paulo destaca somente seu item em vermelho. A situação do arsenal apresenta o aviso amarelo **MANUTENÇÃO EM ATRASO**. O aviso não altera a condição Conforme/Não Conforme registrada no Checklist. O nome duplicado foi retirado; Fazer Checklist manual fica após a situação, Editar Manutenção após as datas e Ativar/Desativar Arsenal antes de Voltar. O rodapé permanece visível em telas pequenas; conteúdo longo pode rolar internamente.

## Persistência e autorização

`stations/{id}.maintenance` aceita um mapa com exatamente `preventiveAnnual`, `electricalAnnual` e `calibrationSemiannual`; cada valor é uma data ISO válida de ano positivo com quatro dígitos, ou string vazia. O campo continua opcional. Texto legado de até 1000 caracteres permanece válido para compatibilidade com abas antigas; não é interpretado como calendário nem apagado por ativação, desativação ou edição do catálogo. O novo formulário salva o mapa quando o administrador cadastra as datas.

Somente a autorização existente `checklistManage` permite atualizar a manutenção. Leitores comuns consultam as datas com controles desabilitados. Versão, autoria, timestamps, lista de campos e exclusão negada foram preservados. As transações usam o estado atual da estação e conservam os calendários ao editar/ativar/desativar. Callbacks atrasados não alteram nem fecham outro banner; UID e permissão são conferidos antes e depois das operações.

## Regras publicadas e confirmadas

Comando executado: `npx.cmd firebase deploy --only firestore:rules --project sahmt-17a16 --non-interactive`.

- Projeto: `sahmt-17a16`; banco `(default)`.
- Release: `projects/sahmt-17a16/releases/cloud.firestore`.
- Ruleset ativo: `d7a1f816-8559-45bf-bd6e-5d99fe319361`.
- Atualização: `2026-10-01T21:31:11.572064Z`.
- Confirmação por GET da API Rules: `2026-10-01T21:31:18.660Z`.
- SHA-256 do conteúdo normalizado LF: `11453afb3b75a51929e254a436fe0058c108f0c060931a5abc0f847d573badf3`, idêntico ao arquivo validado.

Foi publicado o arquivo atual da main. Além do esquema de manutenção, esse arquivo já continha aliases de valores em validações de Eventos: nome do perfil, documento anterior/posterior e chaves alteradas. São as mesmas comparações, permissões e vínculos de histórico, com menos expressões. A tentativa de preservar esses trechos antigos de produção reproduziu a falha preexistente do limite de 1000 expressões ao editar Outros; a versão atual passou toda a suíte. Não houve edição de código de Eventos nesta tarefa nem ampliação de acesso.

O compilador confirmou sucesso; manteve avisos preexistentes de funções de escala não usadas. Nenhum índice, Functions, Worker, Apps Script, gatilho ou configuração de IA foi publicado/ativado por esta operação.

## Verificação

- `npm run test:domain`: 162 testes passaram, incluindo calendários, preservação e corridas de callbacks.
- `npm run test:rules`: 48 testes passaram no emulador, incluindo leitura comum, edição recusada, calendário válido/inválido, autoria/versão/exclusão e preservação ao ativar/desativar.
- `npm run test:label-ai-worker`: 12 testes passaram; sem chamadas de IA de produção.
- `npm run build`: sucesso. Aviso de chunk Firebase acima de 500 kB já existente.
- 16 cenários móveis Chromium emulados: 320×568, 375×667, 390×844 e paisagem 844×390, administrador/leitor, conteúdo curto/longo. Banner centralizado, Voltar visível, calendários sem exceder a largura; vermelho e amarelo medidos. Salvamento/reabertura nessa verificação usa dados fictícios e serviço simulado.
- Cache do shell incrementado para v156, preservando cache da escala e ações IndexedDB.

As evidências locais ficam em `.local-preview/`, sem credenciais nem dados reais de pacientes. A suíte completa do GitHub Actions acompanha o push à main e publica o PWA somente após os checks.

## Conferência que depende de dispositivo e sessão reais

O acesso automatizado ao navegador do usuário não iniciou por erro `apply deny-read ACLs`. Não foi possível realizar login/interação autenticada no PWA de produção nem testar Safari/iPhone/Android físicos. Deploy e conteúdo ativo das Rules foram confirmados independentemente dessa limitação.

Na conferência autenticada do app atualizado:

1. Com administrador, abrir o arsenal, Editar Manutenção, escolher as três datas e Salvar Manutenção; fechar/reabrir e recarregar para confirmar persistência.
2. Em arsenal reservado para conferência, verificar ativação/desativação preservando as datas e um vencimento anterior a hoje produzindo vermelho/aviso amarelo; restaurar a programação/situação correta.
3. Limpar um calendário, salvar e confirmar que somente essa data foi removida.
4. Com leitor comum, confirmar consulta das datas e ausência de edição; verificar calendário nativo, centralização e Voltar no aparelho.