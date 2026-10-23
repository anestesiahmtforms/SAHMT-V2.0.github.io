# Nitidez Retina e zoom no leitor de documentos

## Alteração da versão 224

A página mantém seu tamanho em CSS e ganha resolução de desenho proporcional à densidade da tela, limitada a 3×. Em vez de ampliar um bitmap já desenhado, o zoom solicita uma nova renderização da mesma página PDF.

- Ampliação: 100%, 125%, 150%, 200%, 250% e 300%.
- Botão AJUSTAR retorna à largura disponível; navegação preserva o zoom.
- Contêiner e rodapé permanecem fixos; a página ampliada aceita rolagem vertical e horizontal.
- Uma página ainda não apresentada exige percorrer o conteúdo ampliado antes da confirmação. A margem reservada à barra de rolagem não é tratada como conteúdo não lido.
- Um único canvas é reutilizado, com teto de 4 milhões de pixels e 4096 pixels por dimensão. Fechar libera a renderização.
- Redimensionar a tela redesenha a página localmente. Zoom e ajuste não consultam o serviço de leitura nem o Firestore.
- Extração de texto mantém a API compatível com Safari e continua independente do desenho visual.

As regras de treinamento, permissões, pontuação, arquivos PDF e seus checksums permanecem iguais. O exemplo oficial do [PDF.js para telas HiDPI](https://mozilla.github.io/pdf.js/examples/) fundamenta a separação entre tamanho CSS, resolução do canvas e transformação de desenho.

## Evidência local

Com viewport de 390×844 e densidade 3×, o PDF real de Medicamentos de alta vigilância foi comparado no mesmo tamanho visível:

| Modo | Canvas em pixels | Tamanho exibido |
| --- | --- | --- |
| Resolução simples | 313×442 | 313×442 CSS px |
| Retina | 939×1327 | 313×442 CSS px |
| Zoom de 200% | 1681×2378 | 626×885 CSS px |

O zoom permaneceu dentro do teto de memória, sem requisições adicionais. As imagens de conferência e as provas com o material real ficam privadas, fora do GitHub. O teste do navegador também cobre compatibilidade com a limitação de streams do Safari, conclusão, falha de texto opcional, falha real de desenho, rolagem em zoom máximo e fechamento.

## Inspeção dos PDFs de origem

Foram inspecionados os 20 materiais ROP locais usados na implantação, somando 606 páginas. Um material foi sinalizado pela resolução de imagens grandes. A inspeção visual das páginas sinalizadas mostrou textos nativos e imagens de fundo/ilustração; os PDFs foram preservados. Reexportar indiscriminadamente os documentos reconstruídos a partir desses PDFs não acrescentaria informação ao original e alteraria os checksums de leitura.

Esta é uma inspeção da cópia local desses materiais; não é uma auditoria de todos os arquivos atuais do Drive. A melhoria de renderização beneficia todos os documentos que usam este leitor, inclusive Protocolos e demais categorias.
