# Nomes de exibição das instâncias — versão 227

| Instância | Nome no Firebase | Nome no app | ID preservado |
| --- | --- | --- | --- |
| FC | Registros | Registros | `indicadores---sahmt` |
| FD | Indicadores | Indicadores | `rotinas-8a617` |
| FE | Enquetes - Consultas | Enquetes/Consultas | `outros-48120` |

A API Firebase rejeitou `Enquetes/Consultas` com HTTP 400. O nome do projeto usa hífen, conforme a limitação de caracteres do Google Cloud; a apresentação do app mantém a barra solicitada.

A alteração de metadados usa somente `updateMask=displayName`, com conferência de identidade/proprietário e dos identificadores antes e depois. A cópia de recuperação fica privada. A nomenclatura não implica migração de módulos ou dados: permanecem os mesmos projetos, bancos `(default)`, usuários/UIDs, permissões, OAuth, domínios, aplicativos registrados e roteamento. Nenhum documento Firestore foi consultado ou alterado nessa operação.

Referências: [Firebase projects.patch](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/patch) e [regras de nomes de projetos Google Cloud](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects).
