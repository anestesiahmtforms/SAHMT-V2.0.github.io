# PWA isolada para o piloto administrativo

O piloto usa um Worker de assets separado, `sahmt-auth-pilot`. Ele não substitui
a PWA pública nem o Worker `sahmt-auth-broker` ou o Worker de Etiquetas.
Nenhum UID, segredo HMAC ou credencial administrativa entra no frontend.

## Preparação local

Na raiz da worktree:

```powershell
node scripts/prepare-management-pilot-pwa.mjs --endpoint https://sahmt-auth-broker.anestesiahmtforms.workers.dev/v1/management/session --enabled
```

O argumento `--enabled` habilita apenas as sessões FB/FC no **build isolado**.
Sem esse argumento, o build é produzido com essas sessões desligadas.
O primeiro login especial FA e a interface de classificação permanecem desligados.
`.env.local`, `dist` de produção, o manifesto público e o service worker original
não são modificados. A saída fica em `.local-preview/management-auth-pilot/dist`.
O helper valida o endpoint e as configurações Web de FB/FC antes de compilar.

O build isolado também define `VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS=true`.
Um painel recolhível observa exclusivamente as instâncias Auth que a aplicação
já inicializou. Mostra o estado FA/FB/FC, se FA tem o provedor Google vinculado e
se os UIDs de FB/FC coincidem com FA, apenas como valores booleanos. O relatório
copiável não contém UID, e-mail, nome, tokens ou erros brutos. O observador não
faz login, não solicita tokens e não consulta serviços. A flag fica desligada
por padrão na configuração comum da PWA.
O painel inclui o último resultado da conexão: estados e códigos de uma lista
fechada, sem copiar a resposta original. A troca da identidade FA limpa o resultado
e invalida conclusões atrasadas. A composição do navegador aguarda até 90 segundos
pelas chamadas em segundo plano ao broker; isso não bloqueia Home ou o login FA.

## Pré-condições externas

1. `sahmt-auth-broker` publicado e configurado para o Gateway operacional.
2. Binding privado `MANAGEMENT_AUTH_PILOT_UIDS_JSON` com exatamente o UID confirmado
   do piloto. O frontend não recebe essa lista.
3. `MANAGEMENT_AUTH_PILOT_ONLY=true` e
   `MANAGEMENT_AUTH_PILOT_ORIGIN=https://sahmt-auth-pilot.anestesiahmtforms.workers.dev`.
   O CORS aceita somente essa origem durante o piloto; não há curingas.
4. Domínio `sahmt-auth-pilot.anestesiahmtforms.workers.dev` presente em
   **FA → Authentication → Configurações → Domínios autorizados** antes do login
   Google. Ler essa lista é diferente de alterá-la. Esta preparação local não a altera.
5. Conta piloto já existente em FB/FC com UID correspondente; Gateway e broker
   devem revalidar perfil FA, acesso e permissões independentes em cada solicitação.

O domínio novo do frontend não precisa substituir o `authDomain` Firebase FA:
ele permanece `sahmt-17a16.firebaseapp.com`. FB/FC usam Custom Tokens próprios;
nenhum popup Google adicional é introduzido.

## Publicação isolada autorizada

Após conferir as pré-condições, o operador pode publicar exclusivamente o Worker
de assets com a configuração gerada:

```powershell
npx wrangler deploy --config .local-preview/management-auth-pilot/wrangler.json
```

Esse comando **não é executado pelo preparador**. O nome fixo da configuração é
`sahmt-auth-pilot`, sem binding de banco ou segredo. O endereço deve ser confirmado
na saída da publicação; se diferir, atualizar o domínio autorizado e o CORS antes
de utilizar o piloto.

O manifesto e o service worker gerados usam `/` e caches com prefixo exclusivo
`sahmt-auth-pilot-`. O host deve ser exclusivo: não instalar esses assets na origem
ou no caminho da PWA pública.

## Verificação e reversão

Abrir o host isolado, entrar com a identidade piloto e confirmar FA/FB/FC e logout.
Uma identidade fora da allowlist deve ser recusada antes de lookup/signing nos
destinos. As regras Firestore continuam independentes: sucesso de login não
comprova acesso a dados.

Para conter uma falha, desligar `MANAGEMENT_AUTH_ENABLED` no broker e as operações
no Gateway. Depois remover a implantação isolada ou publicar seu build desativado.
Não alterar a PWA pública. A remoção do domínio temporário autorizado em FA,
quando desejada, exige a ação administrativa correspondente. Não excluir usuários
ou dados como parte da reversão.
