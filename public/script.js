"use strict";

// A cópia do CSV ao final permite abrir index.html diretamente, sem fetch ou servidor.
const COLUNAS = ["id_venda", "data", "produto", "categoria", "regiao", "quantidade", "preco_unitario"];
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = new Intl.NumberFormat("pt-BR");
const comparador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const estado = { registros: [], filtrados: [], pagina: 1, porPagina: 10, ordem: "data", direcao: 1, graficos: {} };
const elemento = (id) => document.getElementById(id);
const normalizar = (texto) => String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const dataBR = (data) => data.split("-").reverse().join("/");
const reais = (centavos) => moeda.format(centavos / 100);

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const ano = Number(valor.slice(0, 4));
  if (ano < 1900 || ano > 2100) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

// Inteiros em centavos evitam erros de ponto flutuante na soma do faturamento.
// Aceitamos ponto OU vírgula decimal, sem separadores de milhar ou símbolos.
function precoEmCentavos(texto) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return null;
  const [parteInteira, decimal = ""] = texto.replace(",", ".").split(".");
  const valor = Number(parteInteira) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(valor) ? valor : null;
}

function validarRegistros(linhas, errosEstruturais = new Set()) {
  const registros = [];
  const motivos = new Map();
  let descartados = 0;
  let camposAusentes = 0;
  function motivo(nome) { motivos.set(nome, (motivos.get(nome) || 0) + 1); }
  linhas.forEach((linha, indice) => {
    const falhas = [];
    const texto = Object.fromEntries(COLUNAS.map((coluna) => [coluna, String(linha[coluna] ?? "").trim()]));
    if (errosEstruturais.has(indice)) falhas.push("quantidade de colunas diferente do cabeçalho");
    if (!texto.id_venda) falhas.push("ID ausente");
    if (!texto.data) falhas.push("data ausente");
    else if (!dataValida(texto.data)) falhas.push("data inválida (use AAAA-MM-DD, entre 1900 e 2100)");
    const quantidade = Number(texto.quantidade);
    if (!texto.quantidade) falhas.push("quantidade ausente");
    else if (!/^\d+$/.test(texto.quantidade) || !Number.isSafeInteger(quantidade)) falhas.push("quantidade inválida (inteiro não negativo)");
    const preco = precoEmCentavos(texto.preco_unitario);
    if (!texto.preco_unitario) falhas.push("preço unitário ausente");
    else if (preco === null) falhas.push("preço inválido (não negativo, até duas casas decimais, sem milhar)");
    const receita = quantidade * preco;
    if (falhas.length === 0 && !Number.isSafeInteger(receita)) falhas.push("faturamento fora do limite numérico seguro");
    if (falhas.length) {
      descartados++;
      falhas.forEach(motivo);
      return;
    }
    for (const campo of ["produto", "categoria", "regiao"]) {
      if (!texto[campo]) { texto[campo] = "Não informado"; camposAusentes++; }
    }
    registros.push({ ...texto, quantidade, preco_centavos: preco, receita_centavos: receita });
  });
  // A soma também precisa ser exata; em caso de estouro, a importação inteira é recusada.
  let total = 0;
  let unidades = 0;
  for (const registro of registros) {
    total += registro.receita_centavos;
    unidades += registro.quantidade;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(unidades)) throw new Error("Os totais excedem o limite numérico seguro. Use uma base com valores menores.");
  }
  const idsUnicos = new Set(registros.map((registro) => registro.id_venda)).size;
  return { registros, descartados, motivos: Array.from(motivos), camposAusentes, repetidos: registros.length - idsUnicos, recebidos: linhas.length };
}

function lerCSV(texto) {
  if (typeof Papa === "undefined") throw new Error("A biblioteca de CSV não carregou. Conecte-se à internet e recarregue a página.");
  // Sem conversão automática: IDs como 001 e valores ausentes devem ser preservados.
  const resultado = Papa.parse(texto.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t"] });
  if (resultado.errors.length) throw new Error("CSV malformado: confira delimitadores e aspas. A base anterior foi preservada.");
  if (resultado.data.length < 2) throw new Error("O CSV precisa conter um cabeçalho e pelo menos um registro.");
  const cabecalho = resultado.data[0].map((nome) => normalizar(nome));
  if (new Set(cabecalho).size !== cabecalho.length) throw new Error("O CSV contém nomes de colunas repetidos.");
  const faltantes = COLUNAS.filter((coluna) => !cabecalho.includes(coluna));
  if (faltantes.length) throw new Error(`Colunas obrigatórias ausentes: ${faltantes.join(", ")}. Consulte a base exemplo.`);
  const errosEstruturais = new Set();
  const linhas = resultado.data.slice(1).map((valores, indice) => {
    if (valores.length !== cabecalho.length) errosEstruturais.add(indice);
    return Object.fromEntries(cabecalho.map((coluna, posicao) => [coluna, valores[posicao] ?? ""]));
  });
  const validacao = validarRegistros(linhas, errosEstruturais);
  validacao.extras = cabecalho.filter((coluna) => !COLUNAS.includes(coluna));
  return validacao;
}

function calcularIndicadores(registros) {
  const faturamento = registros.reduce((soma, registro) => soma + registro.receita_centavos, 0);
  const vendas = new Set(registros.map((registro) => registro.id_venda)).size;
  const unidades = registros.reduce((soma, registro) => soma + registro.quantidade, 0);
  return { faturamento, vendas, unidades, ticket: vendas ? faturamento / vendas : null };
}

function filtrarRegistros(registros, filtros) {
  if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) return [];
  const busca = normalizar(filtros.pesquisa || "");
  return registros.filter((registro) =>
    (!filtros.inicio || registro.data >= filtros.inicio) &&
    (!filtros.fim || registro.data <= filtros.fim) &&
    (!filtros.categoria || registro.categoria === filtros.categoria) &&
    (!filtros.regiao || registro.regiao === filtros.regiao) &&
    (!busca || normalizar([registro.id_venda, registro.produto, registro.categoria, registro.regiao].join(" ")).includes(busca))
  );
}

function agruparReceita(registros, campo) {
  const grupos = new Map();
  registros.forEach((registro) => grupos.set(registro[campo], (grupos.get(registro[campo]) || 0) + registro.receita_centavos));
  return Array.from(grupos).sort((a, b) => b[1] - a[1] || comparador.compare(a[0], b[0]));
}

function serieMensal(registros, inicio, fim) {
  if (!registros.length) return [];
  const datas = registros.map((registro) => registro.data).sort();
  const primeiroMes = (inicio || datas[0]).slice(0, 7);
  const ultimoMes = (fim || datas.at(-1)).slice(0, 7);
  const totais = new Map();
  registros.forEach((registro) => { const mes = registro.data.slice(0, 7); totais.set(mes, (totais.get(mes) || 0) + registro.receita_centavos); });
  const serie = [];
  let [ano, mes] = primeiroMes.split("-").map(Number);
  let chave = primeiroMes;
  // Meses sem registros, dentro do intervalo exibido, entram com receita zero.
  while (chave <= ultimoMes) {
    serie.push([chave, totais.get(chave) || 0]);
    mes++;
    if (mes === 13) { mes = 1; ano++; }
    chave = `${ano}-${String(mes).padStart(2, "0")}`;
  }
  return serie;
}

function avisar(texto, erro = false) {
  elemento("mensagem").textContent = texto;
  elemento("mensagem").hidden = !texto;
  elemento("mensagem").classList.toggle("warning", erro);
}

function descreverQualidade(resultado) {
  const resumo = `${inteiro.format(resultado.registros.length)} registros válidos · ${inteiro.format(resultado.descartados)} descartados`;
  const motivos = resultado.motivos.map(([motivo, quantidade]) => `${quantidade}: ${motivo}`).join("; ");
  const partes = [`${resultado.recebidos} registros recebidos (linhas vazias não são contadas). ${resumo}.`];
  if (motivos) partes.push(`Motivos: ${motivos}. Um registro pode apresentar mais de um motivo.`);
  partes.push(`${resultado.camposAusentes} campos descritivos vazios marcados como “Não informado”. Zero em quantidade ou preço é válido.`);
  if (resultado.repetidos) partes.push(`${resultado.repetidos} ocorrências adicionais de IDs repetidos foram mantidas. Podem representar itens da mesma venda ou duplicações: confira a origem. Toda linha soma receita e unidades; cada ID conta uma venda no recorte.`);
  else partes.push("Cada registro válido possui um ID único. Nenhuma linha foi deduplicada.");
  if (resultado.extras?.length) partes.push(`Colunas extras não utilizadas na análise/exportação: ${resultado.extras.join(", ")}.`);
  return { resumo, detalhe: partes.join(" ") };
}

function carregarBase(resultado, nome, demonstracao) {
  if (!resultado.registros.length) {
    const qualidade = descreverQualidade(resultado);
    throw new Error(`Nenhum registro válido. ${qualidade.detalhe} A base anterior foi preservada.`);
  }
  estado.registros = resultado.registros;
  const qualidade = descreverQualidade(resultado);
  elemento("qualidade-resumo").textContent = `Qualidade da base · ${qualidade.resumo}${resultado.repetidos ? " · atenção: IDs repetidos" : ""}`;
  elemento("qualidade-detalhe").textContent = qualidade.detalhe;
  elemento("qualidade-resumo").parentElement.open = resultado.descartados > 0 || resultado.repetidos > 0;
  elemento("fonte").textContent = demonstracao ? "Dados demonstrativos" : "CSV importado";
  elemento("fonte-detalhe").textContent = demonstracao ? "200 vendas fictícias · janeiro a dezembro de 2025" : `${nome} · processado neste navegador`;
  elemento("restaurar").hidden = demonstracao;
  for (const campo of ["categoria", "regiao"]) {
    const select = elemento(campo);
    select.replaceChildren(new Option(campo === "categoria" ? "Todas as categorias" : "Todas as regiões", ""));
    Array.from(new Set(estado.registros.map((registro) => registro[campo]))).sort(comparador.compare).forEach((valor) => select.add(new Option(valor, valor)));
  }
  limparFiltros();
}

function obterFiltros() {
  return Object.fromEntries(["inicio", "fim", "categoria", "regiao", "pesquisa"].map((campo) => [campo, elemento(campo).value]));
}

function limparFiltros() {
  ["inicio", "fim", "categoria", "regiao", "pesquisa"].forEach((campo) => { elemento(campo).value = ""; });
  estado.ordem = "data";
  estado.direcao = 1;
  atualizar();
}

function atualizar() {
  const filtros = obterFiltros();
  const invalido = Boolean((filtros.inicio && !dataValida(filtros.inicio)) || (filtros.fim && !dataValida(filtros.fim)) || (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim));
  elemento("erro-periodo").hidden = !invalido;
  elemento("erro-periodo").textContent = filtros.inicio && filtros.fim && filtros.inicio > filtros.fim ? "A data inicial deve ser anterior ou igual à data final." : "Use datas válidas entre 1900 e 2100.";
  elemento("inicio").setAttribute("aria-invalid", String(invalido));
  elemento("fim").setAttribute("aria-invalid", String(invalido));
  estado.filtrados = invalido ? [] : filtrarRegistros(estado.registros, filtros);
  estado.pagina = 1;
  const indicadores = calcularIndicadores(estado.filtrados);
  elemento("faturamento").textContent = reais(indicadores.faturamento);
  elemento("vendas").textContent = inteiro.format(indicadores.vendas);
  elemento("unidades").textContent = inteiro.format(indicadores.unidades);
  elemento("ticket").textContent = indicadores.ticket === null ? "—" : reais(indicadores.ticket);
  elemento("contagem").textContent = `${inteiro.format(estado.filtrados.length)} de ${inteiro.format(estado.registros.length)} registros válidos no recorte`;
  elemento("vazio").hidden = estado.filtrados.length > 0;
  elemento("exportar").disabled = !estado.filtrados.length || typeof Papa === "undefined";
  atualizarGraficos(filtros);
  renderizarTabela();
}

function desenharGrafico(id, pares, tipo, cor, horizontal = false) {
  if (typeof Chart === "undefined") return;
  const labels = pares.map(([nome]) => nome);
  const valores = pares.map(([, valor]) => valor / 100);
  if (estado.graficos[id]) {
    estado.graficos[id].data.labels = labels;
    estado.graficos[id].data.datasets[0].data = valores;
    estado.graficos[id].update();
    return;
  }
  const eixoValor = { beginAtZero: true, title: { display: true, text: "Faturamento (R$)", color: "#627087", font: { size: 10 } }, ticks: { color: "#627087", font: { size: 10 }, maxTicksLimit: 6, callback: (valor) => new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(valor) }, grid: { color: "#edf1f7", drawTicks: false }, border: { display: false } };
  const eixoCategoria = { ticks: { color: "#627087", font: { size: 10 }, autoSkip: !horizontal, maxRotation: 0 }, grid: { display: false }, border: { display: false }, title: { display: !horizontal, text: "Mês / ano", color: "#627087", font: { size: 10 } } };
  estado.graficos[id] = new Chart(elemento(id), {
    type: tipo,
    data: { labels, datasets: [{ label: "Faturamento (R$)", data: valores, borderColor: cor, backgroundColor: tipo === "line" ? "rgba(36,92,206,0.07)" : cor, borderWidth: tipo === "line" ? 2.5 : 0, borderRadius: 5, maxBarThickness: 24, fill: tipo === "line", tension: 0.2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? "y" : "x", interaction: { intersect: false, mode: "index" }, plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1d2b45", padding: 12, callbacks: { label: (contexto) => `Faturamento: ${moeda.format(horizontal ? contexto.parsed.x : contexto.parsed.y)}` } } }, scales: { x: horizontal ? eixoValor : eixoCategoria, y: horizontal ? eixoCategoria : eixoValor } }
  });
}

function atualizarGraficos(filtros) {
  const serie = serieMensal(estado.filtrados, filtros.inicio, filtros.fim);
  const meses = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
  const mensal = serie.map(([mes, valor]) => [meses.format(new Date(`${mes}-01T00:00:00Z`)), valor]);
  desenharGrafico("mensal", mensal, "line", "#245cce");
  elemento("mensal-resumo").textContent = serie.length ? `${serie.length} meses exibidos · ${dataBR(serie[0][0] + "-01").slice(3)} a ${dataBR(serie.at(-1)[0] + "-01").slice(3)}. Meses sem registros no intervalo exibido têm receita zero.` : "Sem registros para exibir a evolução mensal.";
  for (const [id, campo, cor] of [["categorias", "categoria", "#4779d9"], ["regioes", "regiao", "#29977f"]]) {
    const grupos = agruparReceita(estado.filtrados, campo);
    elemento(`${id}-container`).style.height = `${Math.max(245, grupos.length * 38 + 55)}px`;
    desenharGrafico(id, grupos, "bar", cor, true);
    const texto = grupos.length ? `${grupos.length} ${campo === "categoria" ? "categorias" : "regiões"} no recorte · valores em ordem decrescente de faturamento.` : "Sem registros para comparar.";
    elemento(`${id}-resumo`).textContent = texto;
    elemento(id).setAttribute("aria-label", `Faturamento por ${campo}: ${grupos.map(([nome, valor]) => `${nome}: ${reais(valor)}`).join("; ") || "sem registros"}`);
  }
  elemento("mensal").setAttribute("aria-label", `Faturamento mensal: ${mensal.map(([mes, valor]) => `${mes}: ${reais(valor)}`).join("; ") || "sem registros"}`);
}

function registrosOrdenados() {
  return [...estado.filtrados].sort((a, b) => {
    const valorA = a[estado.ordem];
    const valorB = b[estado.ordem];
    const diferenca = typeof valorA === "number" ? valorA - valorB : comparador.compare(valorA, valorB);
    return diferenca * estado.direcao;
  });
}

function renderizarTabela() {
  const ordenados = registrosOrdenados();
  const inicio = (estado.pagina - 1) * estado.porPagina;
  const pagina = ordenados.slice(inicio, inicio + estado.porPagina);
  const corpo = elemento("linhas");
  corpo.replaceChildren();
  pagina.forEach((registro) => {
    const linha = document.createElement("tr");
    const valores = [registro.id_venda, dataBR(registro.data), registro.produto, registro.categoria, registro.regiao, inteiro.format(registro.quantidade), reais(registro.preco_centavos), reais(registro.receita_centavos)];
    valores.forEach((valor, indice) => {
      const celula = document.createElement("td");
      if (indice >= 5) celula.className = "numeric";
      // textContent impede que textos do CSV sejam interpretados como HTML.
      if (indice === 3) { const chip = document.createElement("span"); chip.className = "category-chip"; chip.textContent = valor; celula.append(chip); }
      else celula.textContent = valor;
      linha.append(celula);
    });
    corpo.append(linha);
  });
  if (!pagina.length) { const linha = document.createElement("tr"); const celula = document.createElement("td"); celula.colSpan = 8; celula.textContent = "Nenhuma venda encontrada neste recorte."; linha.append(celula); corpo.append(linha); }
  elemento("pagina-resumo").textContent = ordenados.length ? `${inicio + 1}–${Math.min(inicio + estado.porPagina, ordenados.length)} de ${inteiro.format(ordenados.length)} registros · página ${estado.pagina} de ${Math.ceil(ordenados.length / estado.porPagina)}` : "0 registros";
  elemento("anterior").disabled = estado.pagina === 1;
  elemento("proxima").disabled = inicio + estado.porPagina >= ordenados.length;
  document.querySelectorAll("[data-sort]").forEach((botao) => {
    const selecionado = botao.dataset.sort === estado.ordem;
    botao.parentElement.setAttribute("aria-sort", selecionado ? (estado.direcao === 1 ? "ascending" : "descending") : "none");
    botao.querySelector("span").textContent = selecionado ? (estado.direcao === 1 ? "↑" : "↓") : "↕";
  });
}

function gerarCSV(registros) {
  const linhas = registros.map((registro) => ({ id_venda: registro.id_venda, data: registro.data, produto: registro.produto, categoria: registro.categoria, regiao: registro.regiao, quantidade: registro.quantidade, preco_unitario: (registro.preco_centavos / 100).toFixed(2) }));
  // Proteção contra fórmulas em planilhas; mantém as sete colunas para reimportação.
  return Papa.unparse(linhas, { columns: COLUNAS, delimiter: ";", newline: "\r\n", escapeFormulae: true });
}

function exportarCSV() {
  if (!estado.filtrados.length) return;
  const blob = new Blob(["\uFEFF", gerarCSV(registrosOrdenados())], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vendas-filtradas.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisar(`${estado.filtrados.length} registros incluídos no CSV exportado, considerando todos os filtros e a pesquisa.`);
}

async function importarCSV(evento) {
  const arquivo = evento.target.files[0];
  if (!arquivo) return;
  elemento("importar").disabled = true;
  try {
    const resultado = lerCSV(await arquivo.text());
    carregarBase(resultado, arquivo.name, false);
    avisar(`Importação concluída: ${resultado.registros.length} registros válidos e ${resultado.descartados} descartados. Consulte “Qualidade da base” para os detalhes.`, resultado.descartados > 0);
  } catch (erro) { avisar(erro.message, true); }
  finally { elemento("importar").disabled = typeof Papa === "undefined"; evento.target.value = ""; }
}

function carregarDemonstracao() {
  // O CSV fictício é controlado: não contém aspas, vírgulas internas ou campos multilinha.
  // Essa leitura simples mantém os indicadores disponíveis mesmo se a CDN falhar.
  const linhas = DEMO_CSV.trim().split("\n").slice(1).map((linha) => Object.fromEntries(linha.split(",").map((valor, indice) => [COLUNAS[indice], valor])));
  carregarBase(validarRegistros(linhas), "dados-exemplo.csv", true);
  avisar("");
}

function iniciar() {
  const ausentes = [];
  if (typeof Chart === "undefined") ausentes.push("Os gráficos estão indisponíveis porque Chart.js não carregou.");
  if (typeof Papa === "undefined") { ausentes.push("Importação e exportação indisponíveis porque Papa Parse não carregou."); elemento("importar").disabled = true; }
  if (ausentes.length) { elemento("dependencias").hidden = false; elemento("dependencias").textContent = `${ausentes.join(" ")} Verifique a internet e recarregue. Os indicadores, filtros e a tabela demonstrativa continuam disponíveis.`; }
  ["inicio", "fim", "categoria", "regiao"].forEach((campo) => elemento(campo).addEventListener("change", atualizar));
  elemento("pesquisa").addEventListener("input", atualizar);
  elemento("limpar").addEventListener("click", limparFiltros);
  elemento("importar").addEventListener("click", () => elemento("arquivo").click());
  elemento("arquivo").addEventListener("change", importarCSV);
  elemento("exportar").addEventListener("click", exportarCSV);
  elemento("restaurar").addEventListener("click", carregarDemonstracao);
  elemento("anterior").addEventListener("click", () => { estado.pagina--; renderizarTabela(); });
  elemento("proxima").addEventListener("click", () => { estado.pagina++; renderizarTabela(); });
  document.querySelectorAll("[data-sort]").forEach((botao) => botao.addEventListener("click", () => { const campo = botao.dataset.sort; estado.direcao = estado.ordem === campo ? -estado.direcao : 1; estado.ordem = campo; estado.pagina = 1; renderizarTabela(); }));
  carregarDemonstracao();
}

document.addEventListener("DOMContentLoaded", iniciar);

// Base fictícia: mantenha esta cópia sincronizada com dados-exemplo.csv.
const DEMO_CSV = `id_venda,data,produto,categoria,regiao,quantidade,preco_unitario
V0145,2025-01-02,Tapete de yoga,Esporte e lazer,Sudeste,6,99.90
V0001,2025-01-03,Jogo de toalhas,Casa e decoração,Sudeste,3,89.90
V0109,2025-01-03,Tênis casual,Moda,Centro-Oeste,5,229.90
V0181,2025-01-04,Jogo de toalhas,Casa e decoração,Norte,2,89.90
V0013,2025-01-05,Caderno,Papelaria,Sul,6,24.90
V0037,2025-01-06,Caderno,Papelaria,Norte,3,24.90
V0049,2025-01-06,Mouse sem fio,Tecnologia,Centro-Oeste,6,89.90
V0097,2025-01-08,Garrafa térmica,Esporte e lazer,Centro-Oeste,4,69.90
V0121,2025-01-10,Mouse sem fio,Tecnologia,Nordeste,3,89.90
V0169,2025-01-10,Jogo de toalhas,Casa e decoração,Centro-Oeste,8,89.90
V0061,2025-01-12,Cafeteira,Casa e decoração,Sudeste,1,249.90
V0157,2025-01-13,Mouse sem fio,Tecnologia,Sul,4,89.90
V0073,2025-01-14,Tapete de yoga,Esporte e lazer,Norte,3,99.90
V0085,2025-01-16,Kit de canetas,Papelaria,Centro-Oeste,7,19.90
V0025,2025-01-21,Garrafa térmica,Esporte e lazer,Nordeste,1,69.90
V0133,2025-01-28,Notebook,Tecnologia,Centro-Oeste,5,3499.90
V0193,2025-01-28,Garrafa térmica,Esporte e lazer,Sudeste,5,69.90
V0002,2025-02-01,Jogo de toalhas,Casa e decoração,Centro-Oeste,7,89.90
V0086,2025-02-02,Notebook,Tecnologia,Centro-Oeste,3,3499.90
V0110,2025-02-05,Mochila,Moda,Norte,8,149.90
V0194,2025-02-08,Cafeteira,Casa e decoração,Sul,1,249.90
V0098,2025-02-11,Tênis casual,Moda,Nordeste,8,229.90
V0182,2025-02-11,Garrafa térmica,Esporte e lazer,Norte,2,69.90
V0014,2025-02-19,Mouse sem fio,Tecnologia,Sudeste,5,89.90
V0122,2025-02-19,Camiseta,Moda,Norte,7,59.90
V0158,2025-02-19,Mochila,Moda,Sudeste,7,149.90
V0038,2025-02-22,Camiseta,Moda,Sudeste,6,59.90
V0026,2025-02-24,Mochila,Moda,Sul,3,149.90
V0074,2025-02-24,Kit de canetas,Papelaria,Centro-Oeste,6,19.90
V0146,2025-02-25,Garrafa térmica,Esporte e lazer,Sudeste,7,69.90
V0050,2025-02-26,Kit de canetas,Papelaria,Sul,1,19.90
V0134,2025-02-26,Notebook,Tecnologia,Nordeste,5,3499.90
V0062,2025-02-28,Mouse sem fio,Tecnologia,Centro-Oeste,2,89.90
V0170,2025-02-28,Caderno,Papelaria,Centro-Oeste,5,24.90
V0111,2025-03-03,Jogo de toalhas,Casa e decoração,Sul,4,89.90
V0063,2025-03-04,Caderno,Papelaria,Sul,7,24.90
V0135,2025-03-05,Cafeteira,Casa e decoração,Norte,5,249.90
V0195,2025-03-06,Mouse sem fio,Tecnologia,Sul,8,89.90
V0087,2025-03-07,Notebook,Tecnologia,Centro-Oeste,3,3499.90
V0003,2025-03-08,Garrafa térmica,Esporte e lazer,Norte,7,69.90
V0075,2025-03-12,Garrafa térmica,Esporte e lazer,Nordeste,3,69.90
V0027,2025-03-13,Jogo de toalhas,Casa e decoração,Centro-Oeste,4,89.90
V0099,2025-03-14,Mochila,Moda,Norte,3,149.90
V0183,2025-03-18,Notebook,Tecnologia,Nordeste,2,3499.90
V0159,2025-03-19,Tênis casual,Moda,Sul,4,229.90
V0147,2025-03-22,Garrafa térmica,Esporte e lazer,Sudeste,8,69.90
V0039,2025-03-23,Caderno,Papelaria,Sul,4,24.90
V0123,2025-03-23,Notebook,Tecnologia,Nordeste,5,3499.90
V0171,2025-03-26,Jogo de toalhas,Casa e decoração,Norte,5,89.90
V0015,2025-03-27,Luminária,Casa e decoração,Sul,3,119.90
V0051,2025-03-27,Kit de canetas,Papelaria,Norte,2,19.90
V0112,2025-04-02,Garrafa térmica,Esporte e lazer,Centro-Oeste,3,69.90
V0004,2025-04-04,Cafeteira,Casa e decoração,Norte,2,249.90
V0124,2025-04-04,Fone Bluetooth,Tecnologia,Norte,7,189.90
V0100,2025-04-05,Tapete de yoga,Esporte e lazer,Norte,4,99.90
V0148,2025-04-07,Jogo de toalhas,Casa e decoração,Norte,5,89.90
V0184,2025-04-07,Garrafa térmica,Esporte e lazer,Sudeste,8,69.90
V0136,2025-04-09,Mouse sem fio,Tecnologia,Centro-Oeste,6,89.90
V0088,2025-04-10,Tênis casual,Moda,Norte,3,229.90
V0064,2025-04-18,Luminária,Casa e decoração,Centro-Oeste,2,119.90
V0160,2025-04-18,Caderno,Papelaria,Sul,4,24.90
V0028,2025-04-19,Tênis casual,Moda,Norte,7,229.90
V0076,2025-04-20,Fone Bluetooth,Tecnologia,Nordeste,5,189.90
V0172,2025-04-20,Cafeteira,Casa e decoração,Centro-Oeste,5,249.90
V0052,2025-04-22,Caderno,Papelaria,Sul,6,24.90
V0196,2025-04-22,Cafeteira,Casa e decoração,Centro-Oeste,3,249.90
V0016,2025-04-24,Kit de canetas,Papelaria,Centro-Oeste,8,19.90
V0040,2025-04-25,Notebook,Tecnologia,Centro-Oeste,6,3499.90
V0029,2025-05-02,Tapete de yoga,Esporte e lazer,Nordeste,4,99.90
V0101,2025-05-02,Caderno,Papelaria,Centro-Oeste,5,24.90
V0065,2025-05-04,Tênis casual,Moda,Centro-Oeste,6,229.90
V0089,2025-05-05,Mouse sem fio,Tecnologia,Norte,3,89.90
V0005,2025-05-07,Caderno,Papelaria,Sudeste,2,24.90
V0161,2025-05-09,Cafeteira,Casa e decoração,Sudeste,4,249.90
V0053,2025-05-10,Caderno,Papelaria,Nordeste,5,24.90
V0173,2025-05-14,Fone Bluetooth,Tecnologia,Nordeste,7,189.90
V0185,2025-05-14,Fone Bluetooth,Tecnologia,Nordeste,1,189.90
V0137,2025-05-15,Mochila,Moda,Norte,8,149.90
V0125,2025-05-16,Caderno,Papelaria,Sul,7,24.90
V0041,2025-05-17,Mochila,Moda,Sudeste,6,149.90
V0149,2025-05-17,Camiseta,Moda,Norte,1,59.90
V0197,2025-05-19,Garrafa térmica,Esporte e lazer,Sudeste,3,69.90
V0077,2025-05-22,Notebook,Tecnologia,Sudeste,8,3499.90
V0113,2025-05-23,Jogo de toalhas,Casa e decoração,Sul,6,89.90
V0017,2025-05-26,Jogo de toalhas,Casa e decoração,Sudeste,7,89.90
V0006,2025-06-02,Cafeteira,Casa e decoração,Sul,1,249.90
V0018,2025-06-03,Bola de futebol,Esporte e lazer,Sul,7,79.90
V0042,2025-06-03,Tênis casual,Moda,Nordeste,5,229.90
V0090,2025-06-05,Camiseta,Moda,Sudeste,3,59.90
V0102,2025-06-05,Tapete de yoga,Esporte e lazer,Sul,4,99.90
V0078,2025-06-06,Luminária,Casa e decoração,Nordeste,4,119.90
V0030,2025-06-07,Camiseta,Moda,Nordeste,8,59.90
V0174,2025-06-08,Tênis casual,Moda,Sudeste,6,229.90
V0186,2025-06-08,Luminária,Casa e decoração,Sul,8,119.90
V0054,2025-06-09,Garrafa térmica,Esporte e lazer,Nordeste,1,69.90
V0162,2025-06-16,Cafeteira,Casa e decoração,Sul,1,249.90
V0066,2025-06-17,Caderno,Papelaria,Norte,3,24.90
V0126,2025-06-17,Luminária,Casa e decoração,Nordeste,5,119.90
V0138,2025-06-17,Jogo de toalhas,Casa e decoração,Nordeste,8,89.90
V0114,2025-06-21,Tapete de yoga,Esporte e lazer,Centro-Oeste,5,99.90
V0198,2025-06-24,Jogo de toalhas,Casa e decoração,Sudeste,1,89.90
V0150,2025-06-27,Luminária,Casa e decoração,Sul,1,119.90
V0127,2025-07-06,Tênis casual,Moda,Centro-Oeste,5,229.90
V0187,2025-07-12,Caderno,Papelaria,Centro-Oeste,1,24.90
V0055,2025-07-13,Tapete de yoga,Esporte e lazer,Sul,7,99.90
V0139,2025-07-14,Mochila,Moda,Norte,3,149.90
V0199,2025-07-16,Bola de futebol,Esporte e lazer,Sul,1,79.90
V0007,2025-07-17,Jogo de toalhas,Casa e decoração,Norte,4,89.90
V0043,2025-07-17,Bola de futebol,Esporte e lazer,Sudeste,7,79.90
V0103,2025-07-17,Luminária,Casa e decoração,Sudeste,8,119.90
V0091,2025-07-18,Mouse sem fio,Tecnologia,Norte,4,89.90
V0019,2025-07-19,Tapete de yoga,Esporte e lazer,Norte,6,99.90
V0031,2025-07-19,Kit de canetas,Papelaria,Nordeste,5,19.90
V0115,2025-07-20,Camiseta,Moda,Norte,2,59.90
V0175,2025-07-20,Luminária,Casa e decoração,Norte,6,119.90
V0163,2025-07-22,Cafeteira,Casa e decoração,Nordeste,1,249.90
V0067,2025-07-23,Jogo de toalhas,Casa e decoração,Sudeste,5,89.90
V0079,2025-07-26,Garrafa térmica,Esporte e lazer,Norte,7,69.90
V0151,2025-07-28,Mouse sem fio,Tecnologia,Nordeste,2,89.90
V0032,2025-08-01,Jogo de toalhas,Casa e decoração,Norte,7,89.90
V0008,2025-08-07,Caderno,Papelaria,Norte,4,24.90
V0080,2025-08-09,Bola de futebol,Esporte e lazer,Nordeste,2,79.90
V0152,2025-08-09,Jogo de toalhas,Casa e decoração,Centro-Oeste,8,89.90
V0068,2025-08-12,Mouse sem fio,Tecnologia,Centro-Oeste,5,89.90
V0188,2025-08-12,Camiseta,Moda,Centro-Oeste,1,59.90
V0176,2025-08-16,Mouse sem fio,Tecnologia,Centro-Oeste,3,89.90
V0200,2025-08-18,Luminária,Casa e decoração,Sul,2,119.90
V0020,2025-08-20,Kit de canetas,Papelaria,Nordeste,6,19.90
V0044,2025-08-20,Garrafa térmica,Esporte e lazer,Sudeste,6,69.90
V0104,2025-08-21,Garrafa térmica,Esporte e lazer,Norte,7,69.90
V0092,2025-08-22,Caderno,Papelaria,Sul,3,24.90
V0128,2025-08-22,Notebook,Tecnologia,Sul,2,3499.90
V0140,2025-08-22,Cafeteira,Casa e decoração,Centro-Oeste,2,249.90
V0116,2025-08-23,Luminária,Casa e decoração,Nordeste,1,119.90
V0056,2025-08-25,Bola de futebol,Esporte e lazer,Centro-Oeste,5,79.90
V0164,2025-08-25,Bola de futebol,Esporte e lazer,Sudeste,3,79.90
V0189,2025-09-01,Camiseta,Moda,Sudeste,2,59.90
V0153,2025-09-02,Luminária,Casa e decoração,Centro-Oeste,8,119.90
V0045,2025-09-04,Mochila,Moda,Nordeste,3,149.90
V0093,2025-09-04,Tapete de yoga,Esporte e lazer,Norte,6,99.90
V0033,2025-09-05,Camiseta,Moda,Nordeste,4,59.90
V0081,2025-09-09,Tapete de yoga,Esporte e lazer,Centro-Oeste,4,99.90
V0141,2025-09-10,Tapete de yoga,Esporte e lazer,Sudeste,6,99.90
V0057,2025-09-11,Tapete de yoga,Esporte e lazer,Nordeste,5,99.90
V0165,2025-09-13,Garrafa térmica,Esporte e lazer,Sudeste,1,69.90
V0117,2025-09-17,Bola de futebol,Esporte e lazer,Centro-Oeste,2,79.90
V0021,2025-09-18,Camiseta,Moda,Sul,5,59.90
V0069,2025-09-22,Mouse sem fio,Tecnologia,Sudeste,1,89.90
V0009,2025-09-26,Caderno,Papelaria,Sudeste,8,24.90
V0105,2025-09-27,Caderno,Papelaria,Centro-Oeste,8,24.90
V0129,2025-09-27,Mochila,Moda,Centro-Oeste,4,149.90
V0177,2025-09-27,Caderno,Papelaria,Nordeste,6,24.90
V0034,2025-10-11,Bola de futebol,Esporte e lazer,Centro-Oeste,3,79.90
V0190,2025-10-11,Kit de canetas,Papelaria,Nordeste,6,19.90
V0142,2025-10-12,Fone Bluetooth,Tecnologia,Sudeste,4,189.90
V0082,2025-10-14,Notebook,Tecnologia,Sul,3,3499.90
V0130,2025-10-15,Luminária,Casa e decoração,Centro-Oeste,4,119.90
V0010,2025-10-17,Mochila,Moda,Norte,2,149.90
V0178,2025-10-19,Caderno,Papelaria,Norte,4,24.90
V0070,2025-10-20,Bola de futebol,Esporte e lazer,Centro-Oeste,5,79.90
V0058,2025-10-21,Luminária,Casa e decoração,Norte,6,119.90
V0094,2025-10-21,Camiseta,Moda,Centro-Oeste,3,59.90
V0154,2025-10-22,Bola de futebol,Esporte e lazer,Nordeste,7,79.90
V0118,2025-10-23,Fone Bluetooth,Tecnologia,Nordeste,6,189.90
V0106,2025-10-27,Fone Bluetooth,Tecnologia,Norte,6,189.90
V0166,2025-10-27,Fone Bluetooth,Tecnologia,Norte,2,189.90
V0022,2025-10-28,Fone Bluetooth,Tecnologia,Centro-Oeste,6,189.90
V0046,2025-10-28,Tênis casual,Moda,Norte,6,229.90
V0155,2025-11-05,Camiseta,Moda,Sudeste,5,59.90
V0011,2025-11-07,Jogo de toalhas,Casa e decoração,Nordeste,2,89.90
V0071,2025-11-09,Tapete de yoga,Esporte e lazer,Norte,1,99.90
V0167,2025-11-11,Notebook,Tecnologia,Centro-Oeste,1,3499.90
V0023,2025-11-12,Tênis casual,Moda,Norte,3,229.90
V0143,2025-11-12,Caderno,Papelaria,Norte,7,24.90
V0179,2025-11-14,Tapete de yoga,Esporte e lazer,Sul,4,99.90
V0191,2025-11-18,Mochila,Moda,Sudeste,5,149.90
V0095,2025-11-19,Mochila,Moda,Sudeste,8,149.90
V0035,2025-11-21,Bola de futebol,Esporte e lazer,Centro-Oeste,6,79.90
V0083,2025-11-21,Cafeteira,Casa e decoração,Nordeste,4,249.90
V0047,2025-11-24,Camiseta,Moda,Nordeste,8,59.90
V0119,2025-11-24,Fone Bluetooth,Tecnologia,Sul,7,189.90
V0059,2025-11-25,Notebook,Tecnologia,Sul,8,3499.90
V0107,2025-11-26,Fone Bluetooth,Tecnologia,Norte,6,189.90
V0131,2025-11-27,Fone Bluetooth,Tecnologia,Sudeste,4,189.90
V0072,2025-12-01,Tapete de yoga,Esporte e lazer,Centro-Oeste,5,99.90
V0192,2025-12-04,Mochila,Moda,Centro-Oeste,3,149.90
V0060,2025-12-05,Jogo de toalhas,Casa e decoração,Norte,7,89.90
V0048,2025-12-06,Tapete de yoga,Esporte e lazer,Sul,2,99.90
V0096,2025-12-06,Camiseta,Moda,Centro-Oeste,4,59.90
V0120,2025-12-06,Kit de canetas,Papelaria,Sudeste,8,19.90
V0132,2025-12-07,Tapete de yoga,Esporte e lazer,Nordeste,5,99.90
V0036,2025-12-13,Fone Bluetooth,Tecnologia,Nordeste,8,189.90
V0144,2025-12-14,Mouse sem fio,Tecnologia,Sul,3,89.90
V0156,2025-12-14,Camiseta,Moda,Sul,8,59.90
V0084,2025-12-17,Notebook,Tecnologia,Norte,6,3499.90
V0108,2025-12-19,Mouse sem fio,Tecnologia,Norte,1,89.90
V0168,2025-12-19,Fone Bluetooth,Tecnologia,Centro-Oeste,4,189.90
V0012,2025-12-20,Camiseta,Moda,Norte,2,59.90
V0024,2025-12-27,Tapete de yoga,Esporte e lazer,Centro-Oeste,5,99.90
V0180,2025-12-28,Jogo de toalhas,Casa e decoração,Norte,3,89.90
`;
