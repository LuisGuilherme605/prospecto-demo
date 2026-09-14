/**
 * Formatacao de saida no terminal.
 *
 * Cor so e emitida quando a saida e um TTY e `NO_COLOR` nao esta definido --
 * caso contrario o output vira lixo dentro de pipe, arquivo ou log de CI.
 */

const ESC = String.fromCharCode(27);
const COLORIDO = process.stdout.isTTY && !process.env.NO_COLOR;
const codigo = (abre, fecha) => (texto) =>
  (COLORIDO ? `${ESC}[${abre}m${texto}${ESC}[${fecha}m` : String(texto));

export const cor = {
  negrito: codigo(1, 22),
  fraco: codigo(2, 22),
  vermelho: codigo(31, 39),
  verde: codigo(32, 39),
  amarelo: codigo(33, 39),
  azul: codigo(34, 39),
  magenta: codigo(35, 39),
  ciano: codigo(36, 39),
  cinza: codigo(90, 39),
};

export const COR_TIER = { A: cor.verde, B: cor.ciano, C: cor.amarelo, D: cor.cinza };

const PADRAO_ANSI = new RegExp(`${ESC}\\[\\d+m`, 'g');

/** Largura visivel, ignorando codigos ANSI. */
const largura = (texto) => String(texto).replace(PADRAO_ANSI, '').length;

const alinhar = (texto, tamanho, direita) => {
  const espacos = ' '.repeat(Math.max(0, tamanho - largura(texto)));
  return direita ? espacos + texto : texto + espacos;
};

/**
 * Tabela de largura automatica.
 * @param {Array<{chave:string,titulo:string,direita?:boolean}>} colunas
 */
export function tabela(colunas, linhas) {
  const tamanhos = colunas.map((coluna) =>
    Math.max(largura(coluna.titulo), ...linhas.map((linha) => largura(linha[coluna.chave] ?? ''))));

  const cabecalho = colunas.map((c, i) => cor.negrito(alinhar(c.titulo, tamanhos[i], c.direita))).join('  ');
  const divisor = cor.cinza(tamanhos.map((t) => '-'.repeat(t)).join('  '));
  const corpo = linhas.map((linha) =>
    colunas.map((c, i) => alinhar(linha[c.chave] ?? '', tamanhos[i], c.direita)).join('  '));

  return [cabecalho, divisor, ...corpo].join('\n');
}

/** Barra horizontal para visualizar proporcao no terminal. */
export function barra(valor, maximo, tamanho = 24) {
  const preenchido = maximo > 0 ? Math.round((valor / maximo) * tamanho) : 0;
  return '#'.repeat(Math.max(0, preenchido)) + cor.cinza('.'.repeat(Math.max(0, tamanho - preenchido)));
}

export function titulo(texto) {
  return `\n${cor.negrito(texto)}\n${cor.cinza('='.repeat(texto.length))}`;
}

export function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
    .format(valor);
}
