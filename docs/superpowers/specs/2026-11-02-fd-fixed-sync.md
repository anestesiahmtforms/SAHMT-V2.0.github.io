# Atualização FD às 00h e 12h de Brasília

Autorização: usuário pediu implementar as duas janelas e observar consumo posteriormente, preservando comandos manuais e ausência de billing.

- Scheduler privado em Workers Free FD, cron `0 3,15 * * *` UTC; sem endpoint público. Service binding ao Worker FD existente, envelopes HMAC com validade curta.
- Uma solicitação por atividade para distribuir CPU/subrequests. PLAN ordena atividades menos recentes primeiro; ACTIVITY não aceita ator fornecido pelo navegador; FINISH registra resultados. Deduplicação por janela/atividade, sem repetir consumo manual.
- Dois ciclos por dia independentes das quatro tentativas manuais por grupo/dia. Intervalo manual configurável permanece; coleta automática pula dados coletados há menos de10 minutos e preserva resultados em falhas.
- Teto inicial compartilhado entre coletas manuais e automáticas:6000 leituras estimadas de dados por projeto de origem/dia da cota Google (America/Los_Angeles). Reserva transacional antes das consultas e devolução atômica apenas para respostas confirmadas. Falha ambígua mantém reserva conservadora.
- Estimativas não incluem consultas de autenticação/perfis, índices ou outros consumidores. Não equivalem à medição oficial completa do Firebase.
- Manter filtros de ano de FA e seleção de atividade/dependências. Sem alterações de pontuação, login ou dados de origem.
- Mostrar uso diário por FA/FB/FC/FE e situação das últimas janelas na área administrativa de FD. Nenhuma consulta periódica no navegador.
- Na virada do ano, a janela00h fecha o ano anterior;12h coleta o ano atual.

Verificação: horários/virada do ano, HMAC inválido/expirado, deduplicação, orçamento concorrente e reposição, separação manual/automática e preservação de métricas em falha. Conferir bindings, código e cron reais após implantação; confirmar publicação PWA.
