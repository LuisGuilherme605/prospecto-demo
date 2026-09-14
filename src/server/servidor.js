/**
 * Servidor HTTP: estaticos + API JSON, sobre `node:http`.
 *
 * Quando ha senha configurada, tudo passa por autenticacao de sessao antes de
 * chegar na API ou no painel -- as unicas excecoes sao a tela de login, seus
 * proprios recursos e o endpoint de saude, que o orquestrador precisa consultar
 * sem credencial.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarApi } from './api.js';
import { ErroHttp } from './roteador.js';
import { criarAutenticacao, lerCookie, montarCookie, ehHttps, ipDoCliente } from './autenticacao.js';

const RAIZ_PUBLICA = resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const LIMITE_CORPO = 2 * 1024 * 1024; // 2 MB: uma requisicao de API nao precisa de mais.

/**
 * Recursos servidos sem sessao.
 *
 * Precisa cobrir TUDO que a tela de login carrega -- inclusive o proprio script.
 * Esquecer um arquivo aqui nao da erro visivel: o recurso e redirecionado para
 * /login, o navegador recebe HTML onde esperava JavaScript, e a tela de login
 * simplesmente para de funcionar sem nenhuma mensagem.
 */
const PUBLICOS = new Set(['/login', '/login.html', '/login.js', '/estilo.css', '/favicon.ico']);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Cabecalhos de seguranca aplicados a toda resposta.
 *
 * A CSP nao permite `unsafe-inline` em script: o painel usa `<script src>` e
 * constroi o DOM por API, entao nao precisa. Isso e a diferenca entre um XSS
 * hipotetico virar roubo de sessao ou nao virar nada.
 */
const CABECALHOS_SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
};

export function criarServidor(repositorio, opcoes = {}) {
  const { roteador } = montarApi(repositorio, opcoes);
  const confiarProxy = opcoes.confiarProxy ?? false;
  const auth = criarAutenticacao({
    senha: opcoes.senha ?? null,
    segredo: opcoes.segredoSessao,
    duracaoHoras: opcoes.duracaoSessaoHoras,
  });

  return createServer(async (req, res) => {
    const inicio = process.hrtime.bigint();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      return responder(res, 400, { erro: 'URL invalida' });
    }

    try {
      if (await tratarSessao(req, res, url, auth, confiarProxy)) return;

      if (url.pathname.startsWith('/api/')) {
        if (!liberado(req, url, auth)) throw new ErroHttp(401, 'Sessao necessaria');
        await tratarApi(req, res, url, roteador);
      } else {
        if (!liberado(req, url, auth)) return redirecionarParaLogin(res, url);
        await servirEstatico(res, url.pathname);
      }
    } catch (erro) {
      const status = erro instanceof ErroHttp ? erro.status : 500;
      if (status >= 500) console.error('[erro]', erro);
      // Mensagem de erro interno nao vaza detalhe de implementacao para fora.
      responder(res, status, {
        erro: status >= 500 ? 'Erro interno do servidor' : erro.message,
        detalhes: status >= 500 ? null : (erro.detalhes ?? null),
      });
    } finally {
      if (opcoes.log !== false) {
        const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
        console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${ms.toFixed(1)}ms)`);
      }
    }
  });
}

/** A requisicao pode seguir sem sessao valida? */
function liberado(req, url, auth) {
  if (!auth.ativa) return true;
  // /api/saude fica aberto porque o healthcheck da plataforma consulta antes de
  // existir qualquer sessao. Ele devolve so status e contagem, nunca dado pessoal.
  if (url.pathname === '/api/saude') return true;
  if (PUBLICOS.has(url.pathname)) return true;
  return auth.validarToken(lerCookie(req.headers.cookie, auth.NOME_COOKIE));
}

function redirecionarParaLogin(res, url) {
  const destino = encodeURIComponent(url.pathname + url.search);
  res.writeHead(302, { ...CABECALHOS_SEGURANCA, location: `/login?destino=${destino}` });
  res.end();
}

/**
 * Rotas de sessao: login e logout.
 * @returns {Promise<boolean>} true quando a requisicao ja foi respondida aqui
 */
async function tratarSessao(req, res, url, auth, confiarProxy) {
  if (url.pathname !== '/api/sessao') return false;

  if (req.method === 'GET') {
    const valido = !auth.ativa || auth.validarToken(lerCookie(req.headers.cookie, auth.NOME_COOKIE));
    responder(res, valido ? 200 : 401, { autenticado: valido, protecaoAtiva: auth.ativa });
    return true;
  }

  if (req.method === 'DELETE') {
    res.writeHead(200, {
      ...CABECALHOS_SEGURANCA,
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': montarCookie(auth.NOME_COOKIE, '', { maxIdadeSegundos: 0, seguro: ehHttps(req, confiarProxy) }),
    });
    res.end(JSON.stringify({ autenticado: false }));
    return true;
  }

  if (req.method !== 'POST') return false;

  if (!auth.ativa) {
    responder(res, 400, { erro: 'O servidor esta sem protecao por senha' });
    return true;
  }

  const ip = ipDoCliente(req, confiarProxy);
  const limite = auth.limitador.verificar(ip);
  if (limite.bloqueado) {
    res.writeHead(429, { ...CABECALHOS_SEGURANCA, 'content-type': 'application/json; charset=utf-8', 'retry-after': String(limite.esperarSegundos) });
    res.end(JSON.stringify({ erro: `Tentativas demais. Tente de novo em ${Math.ceil(limite.esperarSegundos / 60)} minuto(s).` }));
    return true;
  }

  const corpo = await lerCorpo(req).catch(() => null);
  if (!auth.conferirSenha(corpo?.senha)) {
    const falhas = auth.limitador.registrarFalha(ip);
    console.warn(`[auth] senha incorreta de ${ip} (tentativa ${falhas})`);
    // Atraso fixo: encarece a forca bruta sem revelar nada sobre a senha.
    await new Promise((r) => setTimeout(r, 400));
    responder(res, 401, { erro: 'Senha incorreta' });
    return true;
  }

  auth.limitador.limparSucesso(ip);
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'content-type': 'application/json; charset=utf-8',
    'set-cookie': montarCookie(auth.NOME_COOKIE, auth.emitirToken(), {
      maxIdadeSegundos: auth.duracaoHoras * 3600,
      seguro: ehHttps(req, confiarProxy),
    }),
  });
  res.end(JSON.stringify({ autenticado: true }));
  return true;
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
      ...CABECALHOS_SEGURANCA,
      'content-type': tipo,
      ...(arquivo ? { 'content-disposition': `attachment; filename="${arquivo}"` } : {}),
    });
    return res.end(conteudo);
  }

  return responder(res, 200, resultado);
}

async function servirEstatico(res, caminho) {
  const relativo = caminho === '/' ? '/index.html' : caminho === '/login' ? '/login.html' : caminho;
  // `normalize` + verificacao de prefixo bloqueia travessia de diretorio (`../`).
  const destino = join(RAIZ_PUBLICA, normalize(relativo));
  if (!destino.startsWith(RAIZ_PUBLICA)) throw new ErroHttp(403, 'Acesso negado');

  try {
    const info = await stat(destino);
    if (!info.isFile()) throw new ErroHttp(404, 'Nao encontrado');
    const conteudo = await readFile(destino);
    res.writeHead(200, {
      ...CABECALHOS_SEGURANCA,
      'content-type': TIPOS[extname(destino)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
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
    ...CABECALHOS_SEGURANCA,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}
