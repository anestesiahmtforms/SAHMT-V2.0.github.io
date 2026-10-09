# Transporte HTTPS do login de Gestão

Preparação local de 8 de outubro de 2026. scripts/lib/management-broker-http.js recebe Request e retorna Response, mas não abre porta, não contém credenciais, não hospeda o serviço e permanece desligado por padrão. Requer broker, admissão de requisições, supervisor do host e prazos explícitos. A PWA ainda não importa esses componentes.

## Protocolo

- HTTPS, POST /v1/management/session, sem query, fragmento, Cookie ou Authorization.
- Origem exata https://anestesiahmtforms.github.io; nenhum wildcard. CORS não substitui a verificação de identidade do broker.
- JSON UTF-8 com somente faIdToken. UID, membro, direitos e validade vêm do servidor; expectativas de identidade ficam no cliente.
- Máximo 20 KiB e 512 chunks; chunks vazios, conteúdo inválido e campos adicionais são recusados.
- OPTIONS permite somente POST/Content-Type e não chama admissão, Auth ou Firestore.
- Respostas JSON no-store/no-cache/nosniff. Sucesso copia somente os campos definidos no contrato do broker. Erros brutos, perfis e tokens adicionais nunca são copiados.
- A admissão precisa usar um controle confiável contra abuso; não pode consultar Firestore sem reserva prévia. O handler não implementa esse serviço.

## Cancelamento e conclusão

maxRequestMs limita a resposta desde o início do transporte. Além do timer, o relógio monotônico é conferido antes e depois de admissão/leitura/troca e antes de entregar a resposta; promises já resolvidas não autorizam ultrapassar o prazo enquanto o timer aguarda o event loop. Abort do cliente ou prazo aciona o mesmo sinal passado a broker.exchange(body,{signal}). O núcleo confere o sinal antes e depois de seus adaptadores; não concede retry nem extensão de lease. Após possível escrita, a limpeza usa sinal e prazo próprios para registrar fence somente do grant em questão.

Antes de iniciar a troca, superviseExchange(completion,metadata) deve registrar a promessa no host e retornar true de forma síncrona. Ausência, exceção ou recusa impede chamar o broker. O host deve sustentar essa execução até conclusão, por mecanismo equivalente a waitUntil quando suportado, e persistir o resultado sanitizado. A promessa nunca fornece token ou Response; informa settled, started, requiresReconciliation e código fixo.

cleanupDrainMs é uma janela de vida do host após o prazo de resposta, não uma nova janela de concessão. Deve cobrir o prazo de limpeza configurado no broker e os limites reais da plataforma. O supervisor recebe um maximumLifetimeMs limitado; se o broker não conclui nesse intervalo, o resultado permanece desconhecido e exige reconciliação. Uma resposta HTTP 504 não comprova que a limpeza terminou. O host deve manter journal/fence duráveis, conservar reservas e impedir writes tardios antes de encerrar ou reiniciar o trabalho.

Registrar a promessa num teste não comprova que o host a sustenta. Falha ou encerramento do host ainda pode impedir a limpeza; nenhum transporte oferece atomicidade com Auth ou com dois Firestores. A implementação real de supervisor/journal permanece um gate de ativação.

## Reservas consumidas

O núcleo conserva IDs consumidos mesmo após a validade do recibo. Expiração não permite reciclar ID. A instância nega novas reservas quando atinge 70.000 tombstones locais; isso limita memória e interrompe novas operações, sem limpar a pausa ou a contabilidade. Unicidade e contabilização duráveis entre hosts e reinícios continuam obrigatórias. Tombstones locais não constituem prova de orçamento global.

## Evidências e limites

Testes sintéticos exercitam origem, método, protocolo, body limitado, resposta filtrada, admissão, timeout, cancelamento, supervisão e limpeza. Uma composição com o núcleo real local demonstra HTTP 504 enquanto o cleanup/fence continua pendente sob sinal independente. Nenhum teste chamou Auth/Firestore produtivos ou assinou token de usuário real.

Continuam pendentes: host, runtime publicado, admissão e supervisor duráveis, IAM/signer/verificação de revogação, projection writers, reservas com custos comprovados, backups e reconciliação de identidades, Rules de recursos e fluxo real Safari/PWA instalada. O Worker de Etiquetas e os Apps Scripts existentes não foram alterados.
