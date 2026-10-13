# Contas legadas de treinamento — situação e proteção

As duas contas utilizadas nos testes iniciais de migração de treinamentos ficam preservadas, fora do piloto operacional e não são pré-requisito para habilitar a integração FA–FB–FC. Seus UIDs são resolvidos somente a partir do índice DPAPI do FA; relatórios agregados não exibem endereços nem UIDs.

A lista técnica do scanner continua identificando essas duas contas para uma possível análise futura de retirada. Isso não significa autorização para exclusão nem participação no piloto. Nenhuma conta, perfil ou documento foi excluído, desativado ou alterado.

## Evidência de dependências disponível

A varredura somente de leitura encontrou referências operacionais no FA e no FB, além de referências de auditoria no FA. Três caminhos de coleção-grupo e coleções fora da allowlist não foram cobertos; FC ainda precisa de sessão do proprietário para inventário e consulta. Logo, não existe base para preparar agora uma exclusão simples e segura.

A decisão vigente é preservar as duas contas. Qualquer remoção futura exige inventário completo dos três projetos, revisão das referências históricas e autorização explícita própria. Falhas de consulta ou cobertura parcial mantêm exclusão bloqueada.

## Separação dos administradores

O administrador funcional principal da PWA é uma identidade distinta dos proprietários técnicos. Ser proprietário de Firebase/Google Cloud não confere privilégios PWA. As permissões de Educação e Resultados são derivadas separadamente de permissões específicas e não são concedidas pelo papel global `administrador_app` do FA.
