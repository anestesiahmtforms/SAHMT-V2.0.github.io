# Recuperação online de Gestão e Desempenho — PWA 238

Uma leitura administrativa pontual de `users/{uid}` em FB respondeu HTTP 200, com perfil ativo, acesso permitido e UID correspondente. Isso confirmou a disponibilidade daquele documento no momento da conferência, sem afirmar que a conexão do iPhone foi observada diretamente.

Foram corrigidos três fluxos locais reproduzíveis:

- O prazo de apresentação de sete segundos encerrava a espera pelo perfil, mas a chamada real do SDK continuava. A resposta tardia agora atualiza a sessão usando a mesma chamada. Os consumidores compartilham a leitura em andamento; não há temporizador de repetição. Um erro tardio de autorização, revogação, perfil ausente ou UID diferente continua bloqueando o acesso. Mudanças de geração descartam respostas da identidade anterior.
- Uma falha terminal do transporte de escuta não prova que o transporte REST esteja indisponível. Nessa situação, uma única leitura confirma o perfil, sem reinstalar a escuta que falhou. A pausa conhecida de cota bloqueia essa tentativa antes de acessar a rede.
- Uma confirmação online limpa a exigência local de validação. A mudança entre perfil em cache e perfil online atualiza a apresentação mesmo quando as permissões são idênticas. Desempenho preserva seu módulo e recebe a atualização de conexão; o aviso de perfil local é retirado. Uma falha concorrente de cota permanece protegida.

A atualização não muda projetos, contas, UIDs, permissões, documentos de treinamento ou regras. Os módulos continuam no projeto FB `sahmt-gestao-5ae66`. O shell passa para v238 para distribuir os novos arquivos.

As regressões cobrem resposta tardia, leitura compartilhada, cota concorrente, ausência/revogação de perfil, troca de identidade, recuperação após falha de escuta e os dois módulos no navegador local. Os testes de navegador bloqueiam acessos externos. A implantação continua sujeita aos checks completos do GitHub.
