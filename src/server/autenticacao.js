/**
 * Autenticacao por sessao.
 *
 * O painel expoe nome, cargo, e-mail e telefone de centenas de contatos. Posto
 * na internet sem protecao, isso e um vazamento de dados pessoais esperando
 * acontecer -- e, sob a LGPD, responsabilidade de quem publicou. Por isso a
 * protecao nao e opcional: o servidor se recusa a escutar em interface publica
 * sem senha configurada (ver `exigirConfiguracaoSegura`).
 *
 * O desenho e proposital e minimo: uma senha compartilhada, cookie de sessao
 * assinado com HMAC e sem estado no servidor. Nao ha banco de usuarios porque
 * nao ha requisito de usuarios -- e um cadastro de gente que ninguem administra
 * e pior que nao ter.
 */

import { createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';

const NOME_COOKIE = 'prospecto_sessao';
const DURACAO_PADRAO_H = 12;

/** Comparacao de tamanho constante: `===` em segredo vaza informacao por tempo. */
function iguaisEmTempoConstante(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8');
  const bufferB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual exige mesmo tamanho; o hash normaliza isso sem vazar o
  // comprimento do segredo.
  const hashA = createHmac('sha256', 'comparacao').update(bufferA).digest();
  const hashB = createHmac('sha256', 'comparacao').update(bufferB).digest();
  return timingSafeEqual(hashA, hashB);
}

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/**
 * Limitador de tentativas de login, por IP.
 *
 * Sem isso, uma senha compartilhada cai em forca bruta: sao milhares de
 * tentativas por minuto contra um alvo unico. O atraso cresce com as falhas e
 * zera no acerto.
 */
function criarLimitador({ maxTentativas = 8, janelaMs = 15 * 60_000 } = {}) {
  const tentativas = new Map();

  const limpar = (agora) => {
    for (const [chave, registro] of tentativas) {
      if (agora - registro.primeira > janelaMs) tentativas.delete(chave);
    }
  };

  return {
    /** @returns {{bloqueado: boolean, esperarSegundos: number}} */
    verificar(ip) {
      const agora = Date.now();
      limpar(agora);
      const registro = tentativas.get(ip);
      if (!registro) return { bloqueado: false, esperarSegundos: 0 };

      if (registro.falhas >= maxTentativas) {
        const restante = Math.ceil((registro.primeira + janelaMs - agora) / 1000);
        return { bloqueado: true, esperarSegundos: Math.max(restante, 1) };
      }
      return { bloqueado: false, esperarSegundos: 0 };
    },

    registrarFalha(ip) {
      const agora = Date.now();
      const registro = tentativas.get(ip) ?? { falhas: 0, primeira: agora };
      registro.falhas += 1;
      tentativas.set(ip, registro);
      return registro.falhas;
    },

    limparSucesso(ip) {
      tentativas.delete(ip);
    },

    get tamanho() {
      return tentativas.size;
    },
  };
}

/**
 * Cria o servico de autenticacao.
 *
 * @param {object} opcoes
 * @param {string|null} opcoes.senha        senha compartilhada; `null` desliga a protecao
 * @param {string} [opcoes.segredo]         chave de assinatura do cookie
 * @param {number} [opcoes.duracaoHoras]    validade da sessao
 */
export function criarAutenticacao(opcoes = {}) {
  const senha = opcoes.senha ?? null;
  const duracaoHoras = opcoes.duracaoHoras ?? DURACAO_PADRAO_H;
  const limitador = criarLimitador();

  // Sem segredo explicito, um aleatorio por processo: as sessoes caem a cada
  // reinicio, o que e um incomodo aceitavel e melhor que uma chave previsivel.
  const segredo = opcoes.segredo || randomBytes(32).toString('hex');

  // A senha entra na chave de assinatura: trocar a senha invalida na hora todas
  // as sessoes emitidas com a anterior, sem precisar de lista de revogacao.
  const chave = senha
    ? scryptSync(segredo, `prospecto:${senha}`, 32)
    : Buffer.alloc(32);

  const assinar = (dados) => createHmac('sha256', chave).update(dados).digest('base64url');

  return {
    /** A protecao esta ativa? */
    get ativa() {
      return senha !== null;
    },

    /** Emite um token de sessao valido por `duracaoHoras`. */
    emitirToken(agora = Date.now()) {
      const conteudo = base64url(JSON.stringify({
        exp: agora + duracaoHoras * 3_600_000,
        jti: randomBytes(8).toString('hex'),
      }));
      return `${conteudo}.${assinar(conteudo)}`;
    },

    /** Valida assinatura e expiracao. Nunca lanca. */
    validarToken(token, agora = Date.now()) {
      if (!senha) return true;
      if (typeof token !== 'string' || !token.includes('.')) return false;

      const [conteudo, assinatura] = token.split('.');
      if (!conteudo || !assinatura) return false;
      if (!iguaisEmTempoConstante(assinatura, assinar(conteudo))) return false;

      try {
        const { exp } = JSON.parse(Buffer.from(conteudo, 'base64url').toString('utf8'));
        return typeof exp === 'number' && exp > agora;
      } catch {
        return false;
      }
    },

    /** Confere a senha informada no login. */
    conferirSenha(candidata) {
      return senha !== null && typeof candidata === 'string' && iguaisEmTempoConstante(candidata, senha);
    },

    limitador,
    duracaoHoras,
    NOME_COOKIE,
  };
}

/** Le um cookie especifico do cabecalho, sem depender de parser externo. */
export function lerCookie(cabecalho, nome) {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() === nome) {
      return decodeURIComponent(parte.slice(separador + 1).trim());
    }
  }
  return null;
}

/**
 * Monta o Set-Cookie da sessao.
 *
 * `HttpOnly` impede leitura por JavaScript (barra roubo de sessao via XSS),
 * `SameSite=Strict` barra CSRF, e `Secure` so entra quando a conexao e HTTPS --
 * marcar Secure em HTTP faria o navegador descartar o cookie silenciosamente e
 * o login pareceria simplesmente nao funcionar.
 */
export function montarCookie(nome, valor, { maxIdadeSegundos, seguro }) {
  const partes = [
    `${nome}=${encodeURIComponent(valor)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxIdadeSegundos}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

/**
 * A requisicao chegou por HTTPS?
 *
 * Atras de proxy (Caddy, Nginx, o roteador da plataforma) a conexao interna e
 * HTTP; quem sabe o esquema original e o cabecalho `X-Forwarded-Proto`. So
 * confiamos nele quando `confiarProxy` esta ligado, porque o cliente pode
 * forjar o cabecalho quando fala direto com o servidor.
 */
export function ehHttps(req, confiarProxy) {
  if (req.socket?.encrypted) return true;
  if (!confiarProxy) return false;
  const encaminhado = req.headers['x-forwarded-proto'];
  return String(encaminhado ?? '').split(',')[0].trim() === 'https';
}

/** IP do cliente, respeitando o proxy quando ele e confiavel. */
export function ipDoCliente(req, confiarProxy) {
  if (confiarProxy) {
    const encaminhado = req.headers['x-forwarded-for'];
    if (encaminhado) return String(encaminhado).split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'desconhecido';
}

const ENDERECOS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Impede o erro mais caro do deploy: subir na internet sem senha.
 *
 * Escutar em 127.0.0.1 sem senha e legitimo (uso local). Escutar em 0.0.0.0 sem
 * senha significa expor a carteira inteira, com dados pessoais, a quem achar a
 * URL. O processo falha na inicializacao em vez de subir vulneravel.
 *
 * @throws {Error} quando a combinacao host/senha e insegura
 */
export function exigirConfiguracaoSegura({ host, senha }) {
  const ehLocal = ENDERECOS_LOCAIS.has(host);
  if (ehLocal || senha) return;

  throw new Error(
    `Recusando iniciar: o servidor escutaria em ${host} (acessivel pela rede) sem senha.\n`
    + 'O painel expoe dados pessoais de contatos, entao a protecao e obrigatoria fora do localhost.\n\n'
    + 'Defina a senha na variavel de ambiente PROSPECTO_SENHA:\n'
    + '  PROSPECTO_SENHA="sua-senha-forte" prospecto servir\n\n'
    + 'Para uso apenas local, escute em 127.0.0.1:\n'
    + '  prospecto servir --host 127.0.0.1',
  );
}

export { criarLimitador };
