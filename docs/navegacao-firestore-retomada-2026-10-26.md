# Retomada de perfil e navegação — shell v248

O relato mostra Authentication ativo e perfil local, sem confirmação do Firestore ao retornar ao Checklist. A revisão identificou um caminho não coberto pela v246: uma nova página FA pode iniciar uma consulta de perfil que nunca termina. O prazo visual do coordenador expirava, mas a consulta interna continuava pendente e era reutilizada pelas próximas tentativas. O armazenamento local também podia atrasar indefinidamente a confirmação já obtida do servidor.

## Correção

- A confirmação inicial e a recuperação do próprio perfil usam HTTP autenticado no projeto primário fixado na compilação (FA ou FB), com ID token Firebase e App Check quando configurado. As regras Firestore continuam sendo aplicadas; não há credenciais administrativas, mudança de permissões ou alterações no login das cinco instâncias.
- O transporte tem prazo de 6 segundos, incluindo obtenção do token, atestado, resposta e corpo. Ao expirar, cancela a requisição e libera a consulta pendente para uma nova tentativa. Resultados de outra identidade ou geração são descartados.
- Leitura do cache: 1,5 segundo; continuidade remota: 2,5 segundos; carregamento completo do perfil: 18 segundos. A gravação do cache ocorre depois de emitir a confirmação ou revogação do servidor.
- A recuperação de navegação limita a espera por Auth (12 segundos) e revalidação (20 segundos). Há uma tentativa automática por episódio de falha transitória, respeitando pausas e cotas. Eventos de retorno, navegação e rede continuam coordenados, sem consultas periódicas.
- A chegada tardia do perfil local passa a agendar recuperação mesmo depois de `pageshow`. A mudança do estado de validação atualiza a tela. O aviso oferece “Reconectar” sem exigir reinício do app.
- Observadores ao vivo e rascunhos permanecem no fluxo existente. A v246 continua responsável por preservar e retomar os relatórios suspensos no histórico de navegação.

## Validação

Testes unitários cobrem travamentos de token, App Check, consulta e corpo HTTP; isolamento FA/FB e UID; autorização negada, cota e perfil ausente; liberação das tentativas travadas; cache pendente e revogação; identidade alterada e recuperação após `pageshow`.

`tests/profile-return.browser.test.js` usa `auth.js`, transporte de perfil, `main.js` e ciclo de conexão reais, com identidade, Watch e registros sintéticos. Edge e WebKit confirmaram recuperação automática do Checklist após retorno de outra página, sem recarregar o documento, além de retorno com leitura/escrita do cache travadas. Navegação interna saudável não repetiu leituras do perfil.

Os testes de navegador não equivalem a uma sessão de produção no iPhone nem a consultar as cinco bases reais. O teste de histórico FA–FB e o de FC–Home verificam separadamente os fluxos já existentes. A confirmação final no dispositivo requer instalar o shell v248 e repetir o percurso habitual. Não limpar dados locais: rascunhos e envios pendentes devem ser preservados.

Referência do transporte: https://firebase.google.com/docs/firestore/use-rest-api — requisições autenticadas com Firebase ID token são avaliadas pelas Firestore Security Rules.
