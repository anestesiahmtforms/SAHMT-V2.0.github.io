# Canal operacional provisório — Checklist, Eventos, Etiquetas e Liberar

## Estado e uso

Implementação local, **desativada por padrão**. Não depende do broker FA–FB–FC antigo. O app continua usando o Authentication e o Firestore FA já existentes.

- O registro entra primeiro na fila persistente do aparelho com ID estável.
- Com internet, o canal recebe uma cópia provisória e a mostra aos usuários que já possuem autorização correspondente. Eventos e Etiquetas conservam a filtragem por autoria/participação; não viram dados públicos.
- A consulta do canal e o compartilhamento **não consultam Firestore**. A atualização entre aparelhos acontece em até 60 segundos enquanto o relatório ou a escala está visível; o próprio aparelho atualiza imediatamente.
- Fechar/reabrir offline recupera os provisórios recebidos que ainda tenham cache válido, por usuário e permissões, por até 24 horas. iOS pode apagar armazenamento local: o canal preserva a cópia recebida pelo servidor; um rascunho nunca compartilhado depende do armazenamento do aparelho.
- “Compartilhado · confirmação pendente” não é confirmação oficial nem pontuação. Preceptor e regras de conclusão definitiva conservam os bloqueios de pendência.
- A fila original continua exigindo a confirmação do envio nos tipos já configurados. Recuperar no painel de sincronização restaura **somente os registros do próprio usuário**, não envia nada automaticamente.

## Autorização e leituras

O Worker valida o token Google FA pela API Firebase Authentication em cada chamada e verifica conta ativa/provedor/UID. Não recebe permissões declaradas pelo navegador. Atestações App Check disponíveis são encaminhadas às APIs Firebase; uma falha do provedor não fabrica tokens nem desativa a fiscalização do Firebase. Se a API exigir a atestação ausente, a chamada é recusada.

A ação `authorize` consulta **um documento users/{uid}** para criar/renovar a concessão mínima no servidor, válida por no máximo 24 horas. Não existe renovação periódica de Firestore pelo canal. O cliente evita nova tentativa por 15 minutos após falha e não chama `authorize` com perfil offline. Uma política privada opcional (`OPERATIONAL_CHANNEL_AUTHORIZATION_JSON`) só pode ser emitida com identidades e permissões realmente conferidas; não pode conter UIDs fictícios nem ser publicada na PWA. Revogações do servidor não são contornadas pela política de bootstrap.

Consequência: uma conta sem concessão previamente validada não entra no canal pela primeira vez durante bloqueio do Firestore. A fila local continua disponível. Alterações de permissões ainda não observadas pelo servidor podem levar até o vencimento da concessão para surtir efeito; conta desativada é recusada pelo Authentication em cada chamada.

Após um commit confirmado da fila, `ack` faz uma leitura individual do documento correspondente e compara ID, UID e conteúdo. Não há varredura de coleção. O ACK repetido de registro já confirmado não repete a leitura. Cada confirmação tem no máximo três provas divergentes por recibo; falhas de transporte não gastam esse limite. A recuperação explícita rearma a confirmação sem reenviar registros já conhecidos como gravados. Divergências permanecem para revisão, sem interromper as outras. Nenhum temporizador tenta confirmar registros sem commit conhecido.

## Concorrência, descarte e recuperação

IDs iguais/conteúdo igual são idempotentes. Conteúdo diferente vira conflito. Um item inválido não bloqueia os demais. Descartar uma cópia compartilhada exige retirada comprovada no canal antes de apagar a fila local; tombstones impedem ressurreição por um envio atrasado.

Em Liberar, a projeção é aplicada somente à apresentação, com indicação provisória. Uma alteração mais recente substitui a anterior no canal, preservando histórico. A transação Firestore compara a versão base observada e não rebaseia uma liberação antiga sobre escala modificada. Conflitos e itens antigos sem versão base ficam para revisão. ACK de operação substituída/retirada é recusado.

**Mudança de dia:** as Rules atuais do Checklist só permitem a gravação referente ao dia corrente. Um Checklist de ontem preservado na fila/canal não pode ser enviado como se fosse de hoje. A revisão administrativa é indispensável para conciliar esse histórico, sem trocar sua data ou remover registros. O canal não altera Rules nem cria um caminho administrativo de escrita.

## Capacidade e custos

SQLite Durable Objects com `new_sqlite_classes`, compatível com a oferta Free. Não usa Functions Firebase, Blaze, chave administrativa, cron ou faturamento. As cotas Free continuam limitadas. O Worker não muda o plano automaticamente.

Estimativa de referência, **não garantia de capacidade**: 60 pessoas com um relatório aberto por 8 horas e consulta a cada 60 segundos produzem cerca de 28.800 consultas Worker e 57.600 chamadas DO, antes das autenticações, envios, paginação e demais usos da conta. Uso por 24 horas, múltiplas páginas e outros Workers podem ultrapassar a cota gratuita. Nesse caso o canal falha de forma controlada e a fila local é preservada.

Por coleção/dia: até 2.000 registros e páginas de 40. Pendências e retiradas não são apagadas automaticamente. Confirmados com mais de sete dias são compactados quando o objeto recebe atividade. Ao atingir capacidade, a resposta 507 mantém os registros locais. Não existe limpeza automática que descarte dados pendentes.

Referências: https://developers.cloudflare.com/durable-objects/platform/pricing/ e https://developers.cloudflare.com/durable-objects/platform/limits/.

## Preparação automatizada local

`npm run prepare:provisional-channel`

Executa testes sintéticos e gera `.local-preview/provisional-channel-package/` com bundle, configuração desativada e relatório sem identidades/segredos. Não implanta, não autentica conta real e não consulta Firebase. O runtime local precisa das dependências de desenvolvimento instaladas.

## Instalação externa futura

1. Conferir no Cloudflare que a conta continua Free. Criar o Worker usando este `wrangler.toml`, com as duas migrações SQLite e `OPERATIONAL_CHANNEL_ENABLED=false` inicialmente. O nome reservado proposto é `sahmt-operational-channel`; não pressupor que já existe.
2. Instalar somente a chave Web FA existente em `FA_FIREBASE_WEB_API_KEY`, conferindo suas restrições para o acesso servidor à API Authentication. Não instalar credencial administrativa. Cadastrar uma política privada de bootstrap apenas se houver fonte recente validada; caso contrário, iniciar os usuários quando o Firestore estiver disponível.
3. Conferir a origem publicada fixa `https://anestesiahmtforms.github.io`. Para homologação isolada, `CHANNEL_PILOT_ORIGIN` aceita apenas uma origem HTTPS exata, sem caminho, credenciais ou curingas.
4. Após testes externos sintéticos autorizados, ativar `OPERATIONAL_CHANNEL_ENABLED=true`. A interface só passa a usar o canal quando a variável de build `VITE_OPERATIONAL_CHANNEL_ENDPOINT` tiver a URL HTTPS `/v1/operational-channel` desse Worker. Nenhum segredo vai para a variável do frontend.
5. Publicar o build da PWA com uma nova versão do service worker, conferir dois aparelhos autorizados e verificar registro provisório, visibilidade permitida, confirmação posterior única, logout/troca de usuário e descarte. Não usar registros pessoais para a prova inicial.

**Reversão:** desligar `OPERATIONAL_CHANNEL_ENABLED`, remover a variável de endpoint do próximo build da PWA e republicar o shell. Preservar o banco do canal e as filas locais até conciliação. Não excluir Worker/DO com pendências. O Firestore e a autenticação principal continuam sendo os mesmos.

## Acesso especial de arsenal

A UI foi alinhada às Rules existentes: `checklistManage` permite manutenção/ativação e checagem manual sem QR quando há também a permissão de registro. Não exige mais administração global. A preparação não consulta nem altera perfis reais.

## Aviso de envios pendentes

O banner amarelo aparece imediatamente após inclusão na fila e também ao reabrir com pendências. O verde exige um evento de commit confirmado para o mesmo usuário e nenhuma ação, progresso ou conferência local pendente. Voltar a ter rede, receber uma cópia provisória ou descartar um item não constitui confirmação. O aviso fica à frente dos modais, tem acesso às pendências e não faz leituras no Firestore. A mensagem verde permanece por dez segundos; uma nova pendência volta ao amarelo imediatamente.
