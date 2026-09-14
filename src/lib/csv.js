/**
 * Leitura e escrita de CSV sem dependencia externa.
 *
 * Implementado a mao porque planilha de lead exportada de CRM sempre traz os
 * mesmos problemas: campo com virgula, aspas escapadas, quebra de linha dentro
 * da celula e BOM do Excel. Um `split(',')` quebra em todos eles.
 */

/**
 * Faz o parse de um CSV completo em array de objetos.
 * @param {string} texto
 * @param {object} opcoes { delimitador }
 */
export function lerCsv(texto, opcoes = {}) {
  const linhas = dividirLinhas(texto.replace(/^﻿/, ''), opcoes.delimitador ?? detectarDelimitador(texto));
  if (linhas.length === 0) return [];

  const cabecalho = linhas[0].map((coluna) => coluna.trim());
  return linhas.slice(1)
    .filter((linha) => linha.some((celula) => celula.trim() !== ''))
    .map((linha) => {
      const registro = {};
      cabecalho.forEach((coluna, indice) => {
        registro[coluna] = linha[indice] ?? '';
      });
      return registro;
    });
}

/** Escolhe o delimitador pela primeira linha: virgula ou ponto e virgula (padrao BR). */
export function detectarDelimitador(texto) {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? '';
  const virgulas = (primeiraLinha.match(/,/g) ?? []).length;
  const pontosEVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  return pontosEVirgula > virgulas ? ';' : ',';
}

/** Maquina de estados que respeita aspas e quebras de linha dentro da celula. */
function dividirLinhas(texto, delimitador) {
  const linhas = [];
  let celulas = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i];

    if (dentroDeAspas) {
      if (caractere === '"') {
        if (texto[i + 1] === '"') { atual += '"'; i += 1; }
        else dentroDeAspas = false;
      } else {
        atual += caractere;
      }
      continue;
    }

    if (caractere === '"') { dentroDeAspas = true; continue; }
    if (caractere === delimitador) { celulas.push(atual); atual = ''; continue; }
    if (caractere === '\r') continue;
    if (caractere === '\n') { celulas.push(atual); linhas.push(celulas); celulas = []; atual = ''; continue; }
    atual += caractere;
  }

  if (atual !== '' || celulas.length > 0) {
    celulas.push(atual);
    linhas.push(celulas);
  }
  return linhas;
}

/**
 * Serializa registros em CSV.
 * @param {Array<object>} registros
 * @param {object} opcoes { colunas, delimitador }
 */
export function escreverCsv(registros, opcoes = {}) {
  if (registros.length === 0) return '';
  const delimitador = opcoes.delimitador ?? ',';
  const colunas = opcoes.colunas ?? [...new Set(registros.flatMap((r) => Object.keys(r)))];

  const escapar = (valor) => {
    if (valor === null || valor === undefined) return '';
    const texto = Array.isArray(valor) ? valor.join('|') : String(valor);
    return /["\n\r]|[;,]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const linhas = [colunas.join(delimitador)];
  for (const registro of registros) {
    linhas.push(colunas.map((coluna) => escapar(registro[coluna])).join(delimitador));
  }
  return `${linhas.join('\n')}\n`;
}
