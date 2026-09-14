/**
 * Servidor HTTP: estaticos + API JSON, sobre `node:http`.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarApi } from './api.js';
import { ErroHttp } from './roteador.js';

const RAIZ_PUBLICA = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const LIMITE_CORPO = 2 * 1024 * 1024; // 2 MB: uma requisicao de API nao precisa de mais.

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function criarServidor(repositorio, opcoes = {}) {
  const { roteador } = montarApi(repositorio, opcoes);

  return createServer(async (req, res) => {
    const inicio = process.hrtime.bigint();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      return responder(res, 400, { erro: 'URL invalida' });
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        await tratarApi(req, res, url, roteador);
      } else {
        await servirEstatico(res, url.pathname);
      }
    } catch (erro) {
      const status = erro instanceof ErroHttp ? erro.status : 500;
      if (status >= 500) console.error('[erro]', erro);
      responder(res, status, { erro: erro.message, detalhes: erro.detalhes ?? null });
    } finally {
      if (opcoes.log !== false) {
        const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
        console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${ms.toFixed(1)}ms)`);
      }
    }
  });
}

async function tratarApi(req, res, url, roteador) {
  const rota = roteador.resolver(req.method, url.pathname);
  if (!rota) throw new ErroHttp(404, `Rota nao encontrada: ${req.method} ${url.pathname}`);

  const corpo = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await lerCorpo(req) : null;
  const resultado = await rota.manipulador({
    parametros: rota.parametros,
    query: Object.fromEntries(url.searchParams),
    corpo,
    req,
  });

  // Rotas que devolvem algo que nao e JSON (ex.: CSV) sinalizam via `__resposta`.
  if (resultado && resultado.__resposta) {
    const { tipo, corpo: conteudo, arquivo } = resultado.__resposta;
    res.writeHead(200, {
      'content-type': tipo,
      ...(arquivo ? { 'content-disposition': `attachment; filename="${arquivo}"` } : {}),
    });
    return res.end(conteudo);
  }

  return responder(res, 200, resultado);
}

async function servirEstatico(res, caminho) {
  const relativo = caminho === '/' ? '/index.html' : caminho;
  // `normalize` + verificacao de prefixo bloqueia travessia de diretorio (`../`).
  const destino = join(RAIZ_PUBLICA, normalize(relativo));
  if (!destino.startsWith(RAIZ_PUBLICA)) throw new ErroHttp(403, 'Acesso negado');

  try {
    const info = await stat(destino);
    if (!info.isFile()) throw new ErroHttp(404, 'Nao encontrado');
    const conteudo = await readFile(destino);
    res.writeHead(200, {
      'content-type': TIPOS[extname(destino)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(conteudo);
  } catch (erro) {
    if (erro instanceof ErroHttp) throw erro;
    throw new ErroHttp(404, `Arquivo nao encontrado: ${relativo}`);
  }
}

function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    const pedacos = [];
    let tamanho = 0;
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > LIMITE_CORPO) {
        rejeitar(new ErroHttp(413, 'Corpo da requisicao excede o limite de 2 MB'));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => {
      const texto = Buffer.concat(pedacos).toString('utf8');
      if (texto.trim() === '') return resolver(null);
      try {
        resolver(JSON.parse(texto));
      } catch {
        rejeitar(new ErroHttp(400, 'Corpo da requisicao nao e um JSON valido'));
      }
    });
    req.on('error', rejeitar);
  });
}

function responder(res, status, dados) {
  const corpo = JSON.stringify(dados ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
    'x-content-type-options': 'nosniff',
  });
  res.end(corpo);
}
