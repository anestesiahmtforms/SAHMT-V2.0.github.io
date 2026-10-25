# FC → Home: navegação sem bloqueio (shell 242)

Relato: travamento ao retornar de módulos FC, principalmente Registro de
Ocorrências, exigindo reiniciar o PWA.

## Causas reproduzidas

- Ocorrências desativava o botão Voltar da janela de categorias durante a leitura
  do catálogo. Uma leitura pendente mantinha o diálogo modal aberto e os controles
  da página inacessíveis. O teste no Edge reproduziu o botão desativado.
- Uma montagem atrasada de QMENTUM podia substituir o encerramento do módulo
  seguinte. A validação anterior verificava a rota, sem distinguir duas aberturas
  da mesma página.
- A renderização esperava a fila global de rascunhos locais e o retorno do
  encerramento do módulo antes de mostrar a próxima página.

## Alterações

- Voltar e Escape cancelam a espera pelo catálogo de Ocorrências. A resposta
  atrasada perde a autorização para abrir o formulário; uma nova tentativa tem
  identificação própria. O envio em andamento continua protegido contra saída
  pelo botão de cancelamento.
- As continuações de navegação verificam a geração da página. QMENTUM também
  verifica se seu contêiner permanece conectado e encerra montagens descartadas.
- A fila de rascunhos continua gravando independentemente da navegação. Ao
  reabrir Eventos/Etiquetas, a restauração aguarda somente as gravações daquele
  usuário e módulo, preservando a última revisão capturada.
- Falhas de encerramento de módulo não abortam a abertura da Home.

## Validação local

- Teste do navegador com o `main.js` e as interfaces reais; autenticação,
  repositórios e armazenamento pendente simulados, sem dados de produção.
- Leituras FC pendentes, respostas após saída, reentrada rápida, Voltar/Escape,
  categorias com acesso direto e abertura normal do formulário.
- Testes unitários executam trechos reais de navegação; teste com IndexedDB
  simulado confirma a restauração da última revisão de uma fila de oito edições.
- Suítes gerais, autenticação, operação offline, QMENTUM e compilação FA/FB.

A reprodução local confirma os caminhos corrigidos. A instalação utilizada pelo
usuário ainda precisa receber a atualização e validar o comportamento com sua
conexão real. Esta mudança não reinicializa Auth/Firestore entre módulos.
