# Central de Controle Administrativo e IA

A FI é o destino de Pessoas, Administração, Controle de Atualizações e busca interna. A importação registrou 58 perfis, 31 contatos e 57 classificações de membros. O Firestore da FI aceita acesso por conta de serviço. O PWA usa o login FA e a FI confirma o vínculo de identidade a cada requisição. As projeções alimentam os fluxos de escala em FJ e as solicitações de atualização em FA.

O botão **Buscar no ecossistema**, na Home, e o cartão da Governança abrem a Central quando a publicação habilita `VITE_FI_ADMIN_ENABLED`. Materiais e pastas inativos aparecem em modo de consulta. A busca conserva o público da atividade e não apresenta respostas, confirmações, pontos nem links de formulários. Documentos administrativos restritos exigem classificação EFETIVO atual e as permissões documentais na origem. Registros operacionais exigem autoria ou vínculo em campo formal. As notificações diretas de FF exigem destinatário e publicação vigente.

A busca cobre títulos e descrições dos catálogos de gestão, treinamentos e atividades, além dos registros autorizados dos adaptadores configurados. Os links de arquivos reconhecidos abrem visualizações do Drive. O corpo dos arquivos e as subpastas do Drive ainda não estão indexados. Ocorrências de FC sem vínculo formal de destinatário ficam fora da pesquisa. A primeira versão tem limites de leitura por fonte e devolve até dez resultados classificados.

A análise mensal consulta resultados revisados ou fechados do QMENTUM no FC, conforme o vínculo atual do administrador com cada unidade. Com dados ausentes, o serviço informa a cobertura incompleta. A avaliação técnica usa, quando disponíveis, os registros agregados da rotina de consolidação em FD e distingue dias confirmados, parciais e sem conclusão registrada. Isso cobre a rotina de consolidação. A medição de carregamento, latência de tela e falhas de sincronização de outros módulos exige fontes adicionais. Os planos são propostas para revisão.

## Ativação

1. Conferir `node scripts/fi-control-release.mjs --check-drift` antes da troca. Se houver divergência, revisar e reconciliar os dados de origem antes de transferir a autoridade de escrita.
2. Confirmar as regras FI e o Worker desativado com `node scripts/deploy-fi-control.mjs --apply-disabled`. A conta de serviço deve existir como segredo Cloudflare.
3. Homologar a sessão FA e o App Check com contas autorizadas. Conferir um efetivo, um usuário comum e um administrador, incluindo revogação de grupo, consulta de item inativo e projeção para FA/FJ. Aplicar a mudança do PWA após essa validação.
4. Manter a busca convencional disponível com orçamento de IA zero. Para ativar inferência, verificar créditos e condições da organização de API e configurar o segredo `OPENAI_API_KEY` no Worker. O agendamento mensal preparado requer identidade administrativa vinculada ao FC e as opções de inferência e de agendamento habilitadas. A proposta de horário é o primeiro dia do mês às 03h de Brasília, sujeita à disponibilidade dos dados revisados.

Os relatórios de inventário e importação registram contagens. A captura administrativa e as credenciais locais ficam protegidas por DPAPI. A inspeção inicial encontrou a base FI e os serviços Workers, KV e Durable Objects vazios. O acesso de inventário para D1 e Apps Script foi insuficiente.
