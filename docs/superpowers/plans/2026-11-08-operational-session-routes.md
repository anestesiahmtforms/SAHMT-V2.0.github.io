# Sessões operacionais por rota

Continuação autorizada pelo proprietário: trabalhar as demais rotas após suspender sessões na Home. Aplicar ao mesmo ciclo serial de sessão existente.

## Contrato

Uma instância já inicializada só pode manter/renovar a sessão nas rotas consumidoras abaixo. Habilitar uma rota não cria sessão nem troca token. Sair do conjunto cancela renovação, invalida autenticação pendente e enfileira logout. Voltar exige nova troca sob demanda. Rotas desconhecidas e instâncias desconhecidas falham fechadas.

| Instância | Rotas consumidoras | Evidência |
|---|---|---|
| FI | schedule, events, checklist, admin | Contatos da Escala; registros/catálogos de Eventos; responsabilidade Checklist; formulário administrativo de catálogos |
| FJ | schedule, events, checklist | Escala/férias; painel de escala em Eventos; rotação/responsabilidade Checklist |
| FH | labels, admin | Etiquetas/catálogo/perfil/IA; administração de perfis FH |
| FG | checklist, fg-performance | Registro, estações, responsabilidade/permissões; desempenho FG |

Demais rotas não consomem essas quatro sessões segundo o rastreamento atual. A rota people ainda usa contatos/eventMembers FA: resíduo separado a migrar após confirmar escritores e contrato FI. As sessões FB/FC/FE e o login Google têm implementações diferentes e não são alterados por esta política. Páginas ocultas ficam fora deste patch por depender da retomada correta dos listeners.

## Execução

1. Acrescentar regressões de troca direta entre rotas, compartilhamento FI/FJ e isolamento FH/FG; observar falha antes do patch.
2. Passar station ao vínculo de rota e aplicar a tabela explícita. Manter a fila serial de suspensão/reentrada.
3. Executar testes de sessão, roteamento, cache e ciclo de vida; suíte ampla e build. Documentar o estado local e limites da homologação.

Ruling: preservar categorias compartilhadas e dependências de Checklist FI/FJ — remover por nome de tela interromperia a conferência da responsabilidade. A política limita concessões, não altera autorização do servidor.
