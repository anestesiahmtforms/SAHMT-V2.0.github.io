# Cópia fechada de Gestão em FB

A autorização humana de continuar a migração permite a cópia preparatória dos 134 registros já classificados e auditados. O conteúdo copiado corresponde ao snapshot FA-rec1 de 2026-10-09T19:29:04.765Z, idêntico ao baseline do manifesto v2. Não há nova leitura de FA nesta etapa.

A cópia ocorre no banco FB sahmt-gestao-5ae66/(default), ainda com Rules deny-all. FA permanece intacto e seus escritores continuam. A cópia não ativa PWA, broker, Auth, permissões, avaliação ou pontuação. O manifesto original, seus UIDs, ACLs e proveniência permanecem fixos.

Serão criados 134 documentos e 134 registros de proveniência em um commit atômico, com exists:false em cada criação. Uma leitura consistente de todos os 268 caminhos antes da escrita deve confirmar que nenhum existe. Uma leitura consistente após o commit confere todos os hashes. Conflito, resultado incerto ou falha param a operação e preservam checkpoints DPAPI; não há retry automático.

A autoridade humana manual tem data original e vale para uma execução no mesmo dia de cota LA. Timeout técnico de 120 segundos por operação de rede limita falhas; não representa expiração da autorização. Reservas locais duráveis precedem cada leitura: no máximo 536 leituras reservadas de FB, além da verificação separada das 44 raízes. Isso não mede nem garante o total do projeto.

Metadados/principal/billing/Rules de FB devem ser conferidos imediatamente antes da escrita. Rules deny-all bloqueiam clientes, mas não certificam ausência global de Admin/Functions. O inventário Functions atual respondeu SERVICE_DISABLED, permanecendo não certificado. Não há produtor FB conhecido ativado; se observado, interromper. O recibo deve registrar essa limitação, historicalCapture:true e requiresReconciliationBeforeActivation:true. A liberação produtiva exige reconciliação posterior e continua sujeita aos gates existentes.

Reversão: manter o app e os escritores em FA, FB fechado e as cópias protegidas. Esta etapa não exclui dados de nenhum projeto.
