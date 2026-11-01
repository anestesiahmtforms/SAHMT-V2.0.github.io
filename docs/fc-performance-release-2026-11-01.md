# Liberação proposta: Desempenho FC

Estado em 01/11/2026: publicação e corte autorizados pelo usuário; execução em andamento. O módulo registra novas ações a partir do marco de ativação e mantém os pontos exclusivamente em FC. Não importa histórico nem sincroniza com FB.

## Recursos reais conferidos

| Recurso | Situação |
|---|---|
| Firestore `indicadores---sahmt` | Billing desativado pela API; 58 membros ativos e autorizados |
| `fcPerformanceRuntime/state` | Configuração preparada com `enabled=false`, `effectiveFrom=null`, `automaticFbSync=false` |
| `fcPerformanceReference/team` | Estado PREPARING, sem saldo ou referência fabricados |
| Índices | Cinco índices READY: histórico, créditos e três filas de recuperação |
| Histórico e filas | Nenhum crédito importado; três filas consultadas sem pendências no inventário |
| Apps Script FC | Versão 2 publicada e conferida: FC_ONLY, enabled=false, performanceEnabled=false, executor/script corretos. A dona executou prepararDesempenhoFcV1 e confirmou acesso, zero gatilhos e zero pontos importados |
| Worker FC | URL real configurada, três rotas desativadas, plano Free confirmado; nenhum upgrade ou pagamento |
| PWA | Tela em Registros → Desempenho FC, build e navegação validados localmente. Nenhuma publicação |
| Projeto central e FB | Oito guardas FC e diagnóstico enviados ao HEAD central; implantações existentes, flags e acionadores preservados até a conferência. Nenhum IAM concedido a FC sobre FB |

Pacote servidor candidato: SHA-256 `e2ba80242952d66dd78b89fec5350c487a3c8d8dee033b0f3a0bcf48dabe994f`. Segredos permanecem nas propriedades e no armazenamento protegido; não estão no PWA, nesta documentação ou no Git.

## Alterações para aprovação

1. Enviar o pacote verificado ao novo Apps Script FC, publicar sua próxima versão mantendo o mesmo executor e URL, inicialmente desativado. Conferir `enabled=false`, `performanceEnabled=false`, script e executor corretos. Executar `prepararDesempenhoFcV1` pela conta FC para provar a leitura da configuração sem gravar pontos ou instalar gatilhos.
2. Acrescentar ao HEAD central somente as guardas de oito funções FC em quatro arquivos, mais `FcCentralCutover`. As demais funções e implantações permanecem nos conteúdos anteriores. Primeiro executar `conferirCorteCentralFcV1`: ele informa somente propriedades não secretas e nomes de acionadores, sem UrlFetch. Guardar os valores anteriores em backup protegido.
3. Executar `pararPontuacaoCentralFcV1` pela conta FA. O modo FC_ONLY impede processamento central de participações, entregas FC→FB e rotinas trimestrais FC. A flag central de pontuação de Ocorrências fica false, inclusive para a implantação antiga. Outros processadores centrais continuam disponíveis.
4. Aguardar a drenagem de sete minutos e definir `effectiveFrom` no servidor, nunca antes de `centralStoppedAt + 7 minutos`. Salvar a comprovação do corte e seu hash no runtime FC. A margem evita sobreposição com execuções antigas; a documentação Google informa seis minutos por execução de Apps Script. [Limites oficiais](https://developers.google.com/apps-script/guides/services/quotas).
5. Publicar as regras FC acrescentando somente os acessos do novo módulo. Cada membro autorizado lê seu próprio saldo e histórico limitado; escritas pelo navegador, inclusive de administradores, são negadas. Recibos internos não ficam acessíveis ao cliente.
6. Ativar a configuração de runtime e executar `ativarDesempenhoFcV1` como FC. A função exige comprovação central e cria um único acionador `executarDesempenhoFcV1` a cada 15 minutos. Mantém IA trimestral desativada, sem contratar serviços ou usar Gemini sem prova de camada gratuita. Publicar o resumo inicial e conferir as flags e o acionador efetivo.
7. Publicar o PWA com `VITE_FC_PERFORMANCE_ENABLED=true`. Após a autorização, o workflow passa a habilitar essa flag por padrão; a variável de repositório false continua permitindo suspensão. O padrão local permanece false. A abertura usa o coordenador Google/Firebase atual, a mesma UID e a sessão FC; as permissões por projeto continuam obrigatórias. O envio automático para FB não existe neste módulo. As outras três rotas do piloto têm uma flag independente, ainda false; sua troca exige também os testes de arquivos e referências do plano de isolamento.
8. Validar pelo PWA uma ação identificável após o marco, repetição sem duplicidade, resumo confirmado, recuperação de falha, troca de sessão, negativa de acesso cruzado e acesso às demais estações. Registrar os identificadores de verificação sem narrativas clínicas. Interromper o corte se qualquer pré-condição, identidade, billing ou permissão falhar.

## Reversão

- Antes da ativação, restaurar o HEAD/implantação FC e o PWA pelas versões e hashes do backup. Documentos de configuração novos podem permanecer desativados. Índices não precisam ser apagados.
- Se houver falha depois da ativação, desligar o acesso novo no PWA/Worker, suspender as flags de execução FC e somente o acionador FC criado, e marcar o runtime FC como desativado. Conferir que nenhum processamento está em andamento.
- Preservar todos os créditos, recibos e lançamentos legítimos FC. Não apagar pontos nem reiniciar o transporte para FB automaticamente. A retomada central só pode ser considerada após inventariar créditos já confirmados em FC; a opção do usuário é manter os pontos FC exclusivos.
- Restaurar referências Drive somente com a precondição do readback do corte. Originais FA e as cópias FC permanecem disponíveis. A transferência das referências de imagens é um passo próprio do piloto e ainda não foi aplicada.

## Validação realizada

- Núcleo do pacote exato: sete cenários sintéticos com duplicidade, corte temporal, revogação concorrente, recuperação após falha, identidade/valor forjados e QMENTUM sem outbox FB.
- 85 testes direcionados de acesso, apresentação, ativação, guardas centrais, roteamento e rotação de filas; mais 105 testes existentes de autenticação, contratos QMENTUM e transporte de Ocorrências aprovados.
- 19 testes em emulador, executados juntos sobre as regras geradas: leitura por UID e projeto, perfil revogado, tentativas de escrita pelo cliente, privacidade e preservação de QMENTUM e Ocorrências.
- Navegação real do PWA em navegador de teste isolado, sem sessão pessoal: saída durante consulta pendente, resposta atrasada, reentrada e layout em 320/390/1440 pixels.
- Build completo local de FA, FB e enquetes aprovado. A validação integrada com dados reais após a ativação permanece pendente; os testes locais não a substituem.
- Nove probes HTTP reais repetidos após a preparação confirmaram as três rotas FC bloqueadas, CORS/preflight correto e rejeição de rotas extras, sem gravações.

## Aprovação necessária

A revisão automática recusou a primeira tentativa de publicar o pacote no Apps Script FC existente antes da aprovação. O usuário respondeu “autorizado” ao plano concreto; após essa resposta, a publicação seguiu pelo fluxo normal e a versão 2 foi confirmada. A primeira listagem ainda retornou a versão antiga; consultas diretas posteriores e o GET público confirmaram a nova versão e seu estado desativado. Não houve contorno de aprovação.

O pedido original determina: “Antes da troca em produção ou de movimentações que afetem o ambiente atual, apresente o resultado concreto, os testes e o procedimento de reversão para aprovação.” A aprovação solicitada abrange a publicação e o corte do Desempenho FC descritos acima. Mudanças de autenticação, cobrança ou sincronização futura FC→FB não fazem parte da liberação.
