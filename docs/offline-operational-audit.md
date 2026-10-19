# Continuidade operacional local — diagnóstico de 19/10/2026

Escopo autorizado: Eventos, Etiquetas e Checklist em FA, sem Firestore real e sem publicação. A decisão administrativa posterior autoriza Registro Manual de Etiquetas sem internet; OCR local não é requisito.

## Evidências locais antes da complementação

- `firebase-auth.js` mantém a sessão em IndexedDB, com fallback para persistência local do navegador. Não cria uma autenticação independente do Firebase.
- `firebase.js` usa `memoryLocalCache`, não persistência Firestore. A persistência operacional efetiva é o banco IndexedDB `sahmt-v2-local`, com perfis, cache e outbox separados por UID. Uma segunda inicialização persistente do SDK não corrige chamadas `getDocFromServer` e duplicaria dados sem resolver os bloqueios.
- `readThroughSafeCache` tenta o servidor antes do cache, salvo quando o runtime já reconheceu o modo offline. Com internet e backend indisponível isso pode atrasar Escala, contatos e férias.
- A primeira leitura do perfil em `auth.js` aguarda o Firestore Lite sem prazo próprio. A sessão Google pode estar restaurada e a interface continuar em carregamento.
- Os relatórios têm controle de ownership e encerramento dos listeners; entretanto, o cache operacional é apresentado apenas depois de falha do listener ou offline conhecido.
- O Service Worker já guarda o shell, adaptadores dos relatórios, câmera e ZXing. Dados operacionais pertencem ao IndexedDB, não ao cache HTTP.
- A outbox já conserva identificadores estáveis, partição por UID, conflitos de edição de Eventos, reenvio com espera e confirmação explícita antes do envio de ações locais.
- Falta prontidão dos dados essenciais por módulo, persistência dos formulários ainda em preenchimento e limite de retenção agregado do cache.
- A conferência do preceptor exige relatório, escala e identidade confirmados no servidor. O modo local não pode consolidar pontuação ou inventar o escalado.
- A leitura por IA de Etiquetas usa um Worker e App Check. Sem internet o Registro Manual será o fluxo operacional.

## Critérios de verificação

Testes locais devem usar dados sintéticos e dependências remotas simuladas. Quota, permissão negada, conta diferente, cache vazio/expirado, interrupção de envio e conflito precisam ter resultados distintos. A confirmação de dados, créditos e responsabilidade só ocorre após a validação remota. Safari físico, câmera real e políticas de descarte de armazenamento do iOS continuam exigindo validação no dispositivo; simulação WebKit não comprova hardware.
