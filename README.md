# Panorama de vendas

Dashboard para uma atividade de **Fundamentos de IA e Análise de Dados**, feito com HTML, CSS e JavaScript puro. Permite investigar evolução mensal, receita por categoria e região e o efeito de filtros combinados.

## Abrir o dashboard

Abra **`public/index.html`** com dois cliques em um navegador atualizado. Não é necessário instalar programas, compilar ou iniciar servidor. As 200 vendas **fictícias**, distribuídas entre janeiro e dezembro de 2025, aparecem automaticamente.

É necessário acesso à internet para carregar **Chart.js 4.4.8** e **Papa Parse 5.4.1**, por CDN com versões fixadas. Se essas bibliotecas não carregarem, a página mostra um aviso: os indicadores, os filtros e a tabela demonstrativa continuam disponíveis; os gráficos dependem de Chart.js e a importação/exportação depende de Papa Parse.

## Estrutura

```text
AGENTS.md                 Orientações originais do projeto, preservadas
README.md                 Instruções e regras da análise
public/
  index.html              Estrutura e controles
  styles.css              Aparência e layout responsivo
  script.js               Base inicial, validação, filtros, cálculos e gráficos
  dados-exemplo.csv        200 registros fictícios, com IDs únicos
```

Os arquivos locais são referenciados com caminhos relativos (`./styles.css`, `./script.js`, `./dados-exemplo.csv`). Não há backend, banco de dados, React, dependências locais ou ferramentas de compilação.

Não havia `vendas.csv` na pasta do projeto. A base criada é demonstrativa e não representa uma empresa, tendência real ou relação de causa e efeito. Cada linha representa uma venda única de um produto.

## Importar sua própria base

1. Use **Baixar base exemplo** para obter o modelo.
2. Prepare um arquivo CSV em UTF-8 com o cabeçalho abaixo. A ordem das colunas pode variar; os sete nomes são obrigatórios. Aceitam-se vírgula, ponto e vírgula ou tabulação como delimitador.
3. Clique em **Importar CSV** e escolha o arquivo no seu computador.
4. Confira **Qualidade da base**, que informa registros válidos, descartes e respectivos motivos. Os filtros são reiniciados ao carregar uma base válida.

```csv
id_venda,data,produto,categoria,regiao,quantidade,preco_unitario
V001,2025-01-15,Mouse,Tecnologia,Sul,2,89.90
V002,2025-02-10,Caderno,Papelaria,Norte,3,24.90
```

| Coluna | Significado e formato |
| --- | --- |
| `id_venda` | Identificador textual obrigatório. Zeros à esquerda são preservados. |
| `data` | Data real no formato `AAAA-MM-DD`, entre 1900 e 2100. |
| `produto` | Nome do produto. Vazio aparece como “Não informado”. |
| `categoria` | Grupo do produto. Vazio aparece como “Não informado”. |
| `regiao` | Região da venda. Vazio aparece como “Não informado”. |
| `quantidade` | Inteiro não negativo, sem separadores de milhar. Zero é válido. |
| `preco_unitario` | Valor não negativo, até duas casas decimais, sem moeda e sem separadores de milhar. Zero é válido. |

Aceitam-se `89.90` ou `89,90` como preço. Para a vírgula decimal, use ponto e vírgula como delimitador, ou coloque o valor entre aspas se o delimitador também for vírgula. Formatos como `R$ 89,90`, `1.000,00`, valores negativos, notação científica e quantidades fracionárias são rejeitados.

O arquivo é lido e processado **localmente no navegador**, sem envio dos registros para um servidor. A importação substitui a base atual apenas na memória da página; não altera os arquivos do projeto. Recarregar a página ou clicar em **Voltar à demonstração** restaura os dados fictícios.

### Regras de validação

- Campos vazios de ID, data, quantidade ou preço descartam a linha. Ausência nunca é transformada em zero.
- Datas impossíveis, números inválidos e linhas com quantidade incorreta de colunas são descartados e contabilizados por motivo. Uma linha pode ter mais de um motivo; por isso, a soma dos motivos pode superar o total de linhas descartadas.
- Produto, categoria e região vazios mantêm o registro e recebem “Não informado”. Esses campos são contabilizados no relatório.
- Linhas vazias são ignoradas. Espaços nas extremidades são removidos. Os nomes dos cabeçalhos são normalizados para minúsculas e sem acentos.
- IDs repetidos **não são removidos**. Todos os registros válidos somam receita e unidades, mas cada ID conta uma única venda no recorte. A interface sinaliza repetições para que o aluno confira se são itens de uma venda ou duplicações indevidas.
- Colunas extras são informadas, mas não utilizadas nem exportadas. Categorias e regiões com grafias diferentes são grupos distintos; padronize a base se necessário.
- CSV malformado, cabeçalhos repetidos/incompletos ou uma base sem registros válidos preservam a base anterior. Valores ou somas que excedam a precisão segura de inteiros em JavaScript também são rejeitados.
- A análise não contempla estornos, descontos, frete ou moedas diferentes: considera somente quantidade × preço em reais.

## Indicadores e gráficos

Todos os cálculos consideram **apenas os registros válidos do recorte atual**, incluindo a pesquisa.

| Medida | Fórmula |
| --- | --- |
| Faturamento de uma linha | `quantidade × preco_unitario` |
| Faturamento total | Soma do faturamento de todas as linhas filtradas |
| Quantidade de vendas | Número de `id_venda` distintos nas linhas filtradas |
| Unidades vendidas | Soma de `quantidade` nas linhas filtradas |
| Ticket médio | Faturamento total ÷ quantidade de vendas |

O código trabalha com preços e receitas em **centavos inteiros**. O ticket é arredondado para duas casas apenas na apresentação. Se não houver vendas, o ticket aparece como `—`, pois não se pode dividir por zero; os demais indicadores ficam em zero.

Se uma venda tiver vários itens e um filtro selecionar apenas alguns deles, o ticket representa a receita **dos itens selecionados** dividida pelos IDs presentes nesse recorte. A contagem de vendas por grupos, portanto, não precisa somar a contagem de vendas global.

- **Linha mensal:** soma do faturamento por ano/mês, em ordem cronológica. Os limites de data são inclusivos. O gráfico vai do primeiro ao último mês do recorte, usando as datas dos filtros quando preenchidas. Meses intermediários sem registros recebem zero; meses parcialmente selecionados mostram apenas o intervalo escolhido. Ausência total de registros gera gráfico vazio e aviso.
- **Barras por categoria/região:** somas do faturamento em ordem decrescente. Todas as categorias/regiões do recorte aparecem, com altura ajustada ao número de grupos.
- Os gráficos têm títulos, unidades, tooltips e descrições acessíveis com os valores. Números e moedas seguem `pt-BR`; as datas da tabela aparecem em `DD/MM/AAAA`. O formato visual do seletor de data também depende do navegador/sistema.

## Filtros, tabela e exportação

- Combine período, categoria e região. Cada alteração atualiza cartões, três gráficos, contagem e tabela.
- A pesquisa ignora acentos e diferenças entre maiúsculas/minúsculas e procura ID, produto, categoria ou região. **Ela filtra toda a análise**, não somente a página visível da tabela.
- Clique nos títulos da tabela para alternar entre ordenação crescente e decrescente. Valores são ordenados numericamente. A tabela exibe dez registros por página.
- **Limpar filtros** apaga período, categoria, região e pesquisa, retorna à primeira página e à ordem inicial por data.
- **Exportar CSV** baixa todos os registros filtrados, em sua ordenação atual, inclusive os de outras páginas. O botão fica desativado sem resultados.
- A exportação usa as sete colunas originais, UTF-8 com BOM, delimitador `;`, datas ISO e preços com ponto decimal. Pode ser reimportada. Campos textuais que poderiam ser interpretados como fórmulas por planilhas recebem apóstrofo de proteção; isso pode alterar esses textos específicos numa reimportação. Campos vazios descritivos são exportados como “Não informado”.

## Publicar pelo GitHub e Render

1. Crie um repositório no GitHub.
2. Envie `README.md`, `AGENTS.md` e a pasta **`public` completa**, mantendo essa estrutura. Pelo navegador, use **Add file → Upload files**, arraste a pasta e os arquivos e confirme o commit. Você também pode usar Git localmente se já tiver um repositório configurado.
3. No Render, escolha **New → Static Site** e conecte esse repositório do GitHub.
4. Configure:

| Campo do Render | Valor |
| --- | --- |
| Branch | **A branch que contém o projeto** (por exemplo, `main`, se esse for o nome utilizado) |
| Root Directory | **Vazio** |
| Build Command | `echo "Site pronto"` |
| Publish Directory | `public` |

5. Crie o Static Site e aguarde a publicação. O Render fornecerá uma URL `onrender.com`.
6. Abra a URL, confira os 200 registros demonstrativos, altere os filtros e teste a importação. Com deploy automático habilitado, novos commits na branch selecionada atualizam o site.

O comando de build apenas imprime uma mensagem: os arquivos já estão prontos para hospedagem estática. Não configure um Web Service, comando de inicialização ou backend. Para outra hospedagem estática, publique o conteúdo de `public` como raiz do site.

Este projeto foi preparado e testado localmente; **nenhum repositório ou serviço Render foi criado nem publicado**. A publicação requer sua conta e a conexão com o GitHub. Referência: [documentação de Static Sites do Render](https://render.com/docs/static-sites).

## Como modificar para a atividade

- Edite textos/estrutura em `public/index.html` e cores/layout em `public/styles.css`.
- Em `public/script.js`, as funções `validarRegistros`, `calcularIndicadores`, `filtrarRegistros`, `serieMensal` e `agruparReceita` concentram as regras da análise.
- A constante `DEMO_CSV`, ao final de `script.js`, contém uma cópia exata de `dados-exemplo.csv`. Isso permite abrir por `file://`, sem depender de `fetch`, normalmente bloqueado nesse caso. **Se modificar a base demonstrativa permanente, atualize os dois arquivos e os textos de identificação/período.** Para explorar uma nova base durante a aula, basta importá-la pelo botão.
- Não adicione credenciais ou bases privadas ao repositório: os arquivos publicados de um Static Site ficam acessíveis aos visitantes. O CSV escolhido no navegador continua apenas na sessão local.

## Verificação

- Base demonstrativa: **200 registros, 200 IDs únicos, 12 meses, 910 unidades, R$ 288.929,00 de faturamento e R$ 1.444,65 de ticket médio**. Conferência independente com `Decimal` em Python e comparação com o dashboard.
- Amostra conhecida: linhas de `2 × R$ 10,50`, `1 × R$ 9,00` e `3 × R$ 0,00`, com dois IDs distintos, resultam em **R$ 30,00, 2 vendas, 6 unidades e ticket de R$ 15,00**. O ID repetido permanece na soma e conta uma venda única.
- Verificados validação de datas e números, distinção entre zero e ausência, mês intermediário vazio, filtros combinados, pesquisa sem acentos, ordenação, paginação, limpeza, ausência de resultados, intervalo invertido e preservação da base em importação inválida.
- Verificadas importação CSV com vírgula decimal e delimitador `;`, exportação por download e reimportação do resultado.
- Verificados gráficos e aparência em navegador a 1440, 390 e 320 pixels de largura, e funcionamento com a estrutura `public` servida como raiz estática. Não foram encontradas exceções JavaScript durante as interações. Também foi simulado bloqueio das CDNs, confirmando o aviso e a manutenção dos indicadores demonstrativos.
- Limitação da verificação: a ferramenta de navegador bloqueia URLs `file://`, por isso a abertura com dois cliques não pôde ser automatizada. O projeto usa scripts clássicos, caminhos relativos e dados incorporados, sem `fetch`, para suportar esse uso. O deploy real no Render também não foi executado.

Documentação das bibliotecas: [Chart.js](https://www.chartjs.org/docs/latest/getting-started/) e [Papa Parse](https://www.papaparse.com/docs).
