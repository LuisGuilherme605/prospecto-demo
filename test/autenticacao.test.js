/**
 * Testes de autenticacao.
 *
 * E a camada que separa "painel interno" de "vazamento de dados pessoais", entao
 * os testes cobrem tanto o caminho feliz quanto as tentativas de contorno:
 * cookie forjado, sessao expirada, forca bruta e subida insegura.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  criarAutenticacao, lerCookie, montarCookie, ehHttps, ipDoCliente,
  exigirConfiguracaoSegura, criarLimitador,
} from '../src/server/autenticacao.js';
import { Repositorio } from '../src/store/repositorio.js';
import { criarServidor } from '../src/server/servidor.js';
import { gerarCarteira } from '../src/data/gerador.js';

const SENHA = 'senha-de-teste-bem-longa';

describe('criarAutenticacao', () => {
  const auth = criarAutenticacao({ senha: SENHA, segredo: 'segredo-fixo' });

  test('token recem-emitido e valido', () => {
    assert.equal(auth.validarToken(auth.emitirToken()), true);
  });

  test('token expirado e recusado', () => {
    const emitidoOntem = auth.emitirToken(Date.now() - 48 * 3_600_000);
    assert.equal(auth.validarToken(emitidoOntem), false);
  });

  test('assinatura adulterada e recusada', () => {
    const token = auth.emitirToken();
    const [conteudo] = token.split('.');
    assert.equal(auth.validarToken(`${conteudo}.assinaturafalsa`), false);
  });

  test('conteudo adulterado invalida a assinatura', () => {
    const [, assinatura] = auth.emitirToken().split('.');
    const futuro = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url');
    assert.equal(auth.validarToken(`${futuro}.${assinatura}`), false);
  });

  test('lixo nao derruba a validacao', () => {
    for (const entrada of [null, undefined, '', 'abc', '.', 'a.b.c', 42, {}, 'a.'.repeat(500)]) {
      assert.equal(auth.validarToken(entrada), false, `entrada ${JSON.stringify(entrada)} passou`);
    }
  });

  test('token de outro segredo nao vale neste servidor', () => {
    const outro = criarAutenticacao({ senha: SENHA, segredo: 'segredo-diferente' });
    assert.equal(auth.validarToken(outro.emitirToken()), false);
  });

  test('trocar a senha invalida as sessoes existentes', () => {
    // Sem lista de revogacao: a senha entra na chave de assinatura, entao os
    // tokens antigos deixam de conferir sozinhos.
    const token = auth.emitirToken();
    const depoisDaTroca = criarAutenticacao({ senha: 'outra-senha', segredo: 'segredo-fixo' });
    assert.equal(depoisDaTroca.validarToken(token), false);
  });

  test('confere a senha corretamente', () => {
    assert.equal(auth.conferirSenha(SENHA), true);
    assert.equal(auth.conferirSenha('errada'), false);
    assert.equal(auth.conferirSenha(`${SENHA} `), false);
    for (const entrada of [null, undefined, 123, {}]) {
      assert.equal(auth.conferirSenha(entrada), false);
    }
  });

  test('sem senha configurada, a protecao fica inativa e tudo passa', () => {
    const aberto = criarAutenticacao({ senha: null });
    assert.equal(aberto.ativa, false);
    assert.equal(aberto.validarToken('qualquer-coisa'), true);
    assert.equal(aberto.conferirSenha(''), false);
  });
});

describe('criarLimitador', () => {
  test('bloqueia depois do limite de tentativas', () => {
    const limitador = criarLimitador({ maxTentativas: 3, janelaMs: 60_000 });
    assert.equal(limitador.verificar('1.2.3.4').bloqueado, false);
    for (let i = 0; i < 3; i += 1) limitador.registrarFalha('1.2.3.4');
    assert.equal(limitador.verificar('1.2.3.4').bloqueado, true);
  });

  test('o bloqueio e por IP, nao global', () => {
    const limitador = criarLimitador({ maxTentativas: 2, janelaMs: 60_000 });
    limitador.registrarFalha('1.1.1.1');
    limitador.registrarFalha('1.1.1.1');
    assert.equal(limitador.verificar('1.1.1.1').bloqueado, true);
    assert.equal(limitador.verificar('9.9.9.9').bloqueado, false);
  });

  test('acerto limpa o historico de falhas', () => {
    const limitador = criarLimitador({ maxTentativas: 2, janelaMs: 60_000 });
    limitador.registrarFalha('2.2.2.2');
    limitador.limparSucesso('2.2.2.2');
    limitador.registrarFalha('2.2.2.2');
    assert.equal(limitador.verificar('2.2.2.2').bloqueado, false);
  });

  test('registros vencidos sao descartados e nao vazam memoria', () => {
    const limitador = criarLimitador({ maxTentativas: 5, janelaMs: 1 });
    limitador.registrarFalha('3.3.3.3');
    return new Promise((resolver) => setTimeout(() => {
      limitador.verificar('4.4.4.4');
      assert.ok(limitador.tamanho <= 1);
      resolver();
    }, 5));
  });
});

describe('cookies e proxy', () => {
  test('le o cookie certo entre varios', () => {
    const cabecalho = 'outro=1; prospecto_sessao=abc123; tema=escuro';
    assert.equal(lerCookie(cabecalho, 'prospecto_sessao'), 'abc123');
    assert.equal(lerCookie(cabecalho, 'inexistente'), null);
    assert.equal(lerCookie(undefined, 'x'), null);
  });

  test('o cookie de sessao traz as protecoes obrigatorias', () => {
    const cookie = montarCookie('s', 'v', { maxIdadeSegundos: 3600, seguro: true });
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Max-Age=3600/);
  });

  test('Secure so entra quando a conexao e HTTPS', () => {
    // Marcar Secure em HTTP faz o navegador descartar o cookie em silencio, e o
    // login parece simplesmente nao funcionar.
    assert.doesNotMatch(montarCookie('s', 'v', { maxIdadeSegundos: 60, seguro: false }), /Secure/);
  });

  test('so confia em X-Forwarded-Proto quando o proxy e confiavel', () => {
    const req = { headers: { 'x-forwarded-proto': 'https' }, socket: {} };
    assert.equal(ehHttps(req, true), true);
    // Sem proxy declarado, o cliente poderia forjar o cabecalho para fazer o
    // servidor achar que a conexao e segura.
    assert.equal(ehHttps(req, false), false);
  });

  test('conexao TLS direta e reconhecida sem proxy', () => {
    assert.equal(ehHttps({ headers: {}, socket: { encrypted: true } }, false), true);
  });

  test('IP do cliente respeita o proxy so quando confiavel', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(ipDoCliente(req, true), '203.0.113.9');
    assert.equal(ipDoCliente(req, false), '10.0.0.1');
  });
});

describe('exigirConfiguracaoSegura', () => {
  test('recusa escutar em interface publica sem senha', () => {
    // Esta e a protecao contra o erro mais caro do deploy: subir na internet com
    // dados pessoais e nenhuma barreira.
    assert.throws(() => exigirConfiguracaoSegura({ host: '0.0.0.0', senha: null }), /Recusando iniciar/);
  });

  test('aceita interface publica quando ha senha', () => {
    assert.doesNotThrow(() => exigirConfiguracaoSegura({ host: '0.0.0.0', senha: 'x' }));
  });

  test('aceita localhost sem senha', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      assert.doesNotThrow(() => exigirConfiguracaoSegura({ host, senha: null }));
    }
  });
});

describe('servidor protegido', () => {
  let servidor;
  let repositorio;
  let base;

  before(async () => {
    repositorio = new Repositorio(':memory:');
    repositorio.salvarLeads(gerarCarteira({ quantidade: 30, semente: 'auth' }));
    servidor = criarServidor(repositorio, { log: false, senha: SENHA, segredoSessao: 'fixo' });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    await new Promise((r) => servidor.close(r));
    repositorio.fechar();
  });

  const entrar = async () => {
    const resposta = await fetch(`${base}/api/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: SENHA }),
    });
    const cookie = resposta.headers.getSetCookie()[0].split(';')[0];
    return cookie;
  };

  test('API sem sessao responde 401', async () => {
    for (const rota of ['/api/leads', '/api/resumo', '/api/previsao', '/api/fila']) {
      assert.equal((await fetch(`${base}${rota}`)).status, 401, `${rota} ficou aberta`);
    }
  });

  test('painel sem sessao redireciona para o login preservando o destino', async () => {
    const resposta = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(resposta.status, 302);
    assert.match(resposta.headers.get('location'), /^\/login\?destino=/);
  });

  test('a tela de login e TODOS os recursos que ela carrega ficam acessiveis', async () => {
    // O script da propria tela de login ja ficou de fora desta lista uma vez: o
    // navegador recebia HTML no lugar do JavaScript e o formulario parava de
    // funcionar em silencio. O teste percorre o que o HTML realmente pede.
    const html = await (await fetch(`${base}/login`)).text();
    const referencias = [...html.matchAll(/(?:src|href)="(\/?[\w.-]+\.(?:js|css))"/g)]
      .map((casamento) => (casamento[1].startsWith('/') ? casamento[1] : `/${casamento[1]}`));

    assert.ok(referencias.includes('/login.js'), 'a tela de login deveria carregar login.js');

    for (const rota of ['/login', '/login.html', ...new Set(referencias)]) {
      const resposta = await fetch(`${base}${rota}`, { redirect: 'manual' });
      assert.equal(resposta.status, 200, `${rota} deveria ser publica, veio ${resposta.status}`);
    }
  });

  test('o healthcheck fica aberto para a plataforma', async () => {
    // Sem isso, o orquestrador marcaria o container como insalubre e ficaria
    // reiniciando o servico para sempre.
    const resposta = await fetch(`${base}/api/saude`);
    assert.equal(resposta.status, 200);
    const dados = await resposta.json();
    assert.equal(dados.status, 'ok');
    // E nao pode vazar dado pessoal para quem nao esta autenticado.
    assert.deepEqual(Object.keys(dados).sort(), ['leads', 'status', 'versao']);
  });

  test('senha errada responde 401 sem emitir cookie', async () => {
    const resposta = await fetch(`${base}/api/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: 'errada' }),
    });
    assert.equal(resposta.status, 401);
    assert.equal(resposta.headers.getSetCookie().length, 0);
  });

  test('senha certa emite cookie HttpOnly e libera a API', async () => {
    const resposta = await fetch(`${base}/api/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: SENHA }),
    });
    assert.equal(resposta.status, 200);
    const cookie = resposta.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const comSessao = await fetch(`${base}/api/leads`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(comSessao.status, 200);
  });

  test('cookie forjado nao abre a API', async () => {
    const resposta = await fetch(`${base}/api/leads`, {
      headers: { cookie: 'prospecto_sessao=forjado.assinatura' },
    });
    assert.equal(resposta.status, 401);
  });

  test('logout apaga o cookie', async () => {
    const cookie = await entrar();
    const resposta = await fetch(`${base}/api/sessao`, { method: 'DELETE', headers: { cookie } });
    assert.equal(resposta.status, 200);
    assert.match(resposta.headers.getSetCookie()[0], /Max-Age=0/);
  });

  test('todas as respostas trazem os cabecalhos de seguranca', async () => {
    const cookie = await entrar();
    for (const rota of ['/', '/api/resumo', '/login']) {
      const resposta = await fetch(`${base}${rota}`, { headers: { cookie } });
      assert.equal(resposta.headers.get('x-frame-options'), 'DENY', `${rota} sem x-frame-options`);
      assert.equal(resposta.headers.get('x-content-type-options'), 'nosniff');
      assert.match(resposta.headers.get('content-security-policy'), /default-src 'self'/);
    }
  });

  test('a CSP nao libera script inline', async () => {
    // Com 'unsafe-inline' em script, um XSS voltaria a ser exploravel; o painel
    // nao usa script inline justamente para poder proibir.
    const csp = (await fetch(`${base}/login`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  });

  test('erro interno nao vaza detalhe de implementacao', async () => {
    const cookie = await entrar();
    const resposta = await fetch(`${base}/api/leads/../../etc/passwd`, { headers: { cookie } });
    assert.ok(resposta.status >= 400);
    const corpo = await resposta.text();
    assert.doesNotMatch(corpo, /\/home\/|node_modules|at Object\./);
  });

  test('forca bruta e barrada depois de varias tentativas', async () => {
    const tentar = () => fetch(`${base}/api/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: `chute-${Math.random()}` }),
    });

    let bloqueou = false;
    for (let i = 0; i < 12; i += 1) {
      const resposta = await tentar();
      if (resposta.status === 429) {
        assert.ok(resposta.headers.get('retry-after'));
        bloqueou = true;
        break;
      }
    }
    assert.ok(bloqueou, 'o limitador deveria bloquear antes de 12 tentativas');
  });
});

describe('modo demonstracao', () => {
  test('permite subir exposto sem senha, e so nesse modo', () => {
    // A guarda existe para proteger dado pessoal. Numa carteira 100% sintetica
    // nao ha dado de pessoa real, entao a excecao e legitima -- mas precisa ser
    // explicita, nunca o padrao.
    assert.throws(() => exigirConfiguracaoSegura({ host: '0.0.0.0', senha: null }));
    assert.doesNotThrow(() => exigirConfiguracaoSegura({ host: '0.0.0.0', senha: null, modoDemo: true }));
  });

  test('a mensagem de recusa ensina as tres saidas', () => {
    try {
      exigirConfiguracaoSegura({ host: '0.0.0.0', senha: null });
      assert.fail('deveria ter lancado');
    } catch (erro) {
      assert.match(erro.message, /PROSPECTO_SENHA/);
      assert.match(erro.message, /127\.0\.0\.1/);
      assert.match(erro.message, /PROSPECTO_MODO_DEMO/);
    }
  });

  describe('servidor em modo demo', () => {
    let servidor;
    let repositorio;
    let base;

    before(async () => {
      repositorio = new Repositorio(':memory:');
      repositorio.salvarLeads(gerarCarteira({ quantidade: 40, semente: 'demo' }));
      servidor = criarServidor(repositorio, {
        log: false, senha: null, modoDemo: true, sementeDemo: 'demo', quantidadeDemo: 40,
      });
      await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${servidor.address().port}`;
    });

    after(async () => {
      await new Promise((r) => servidor.close(r));
      repositorio.fechar();
    });

    test('anuncia o modo para o painel exibir o aviso', async () => {
      const modo = await (await fetch(`${base}/api/modo`)).json();
      assert.equal(modo.demo, true);
    });

    test('o painel abre sem login', async () => {
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal((await fetch(`${base}/api/leads`)).status, 200);
    });

    test('restaurar devolve a carteira ao estado inicial', async () => {
      // Sem isso, o primeiro visitante que mexer nos pesos do ICP estraga a
      // demonstracao para todos os seguintes.
      const antes = await (await fetch(`${base}/api/leads?porPagina=1`)).json();

      await fetch(`${base}/api/icp`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setoresAlvo: ['agro'], composicao: { fit: 0.9, intencao: 0.05, acessibilidade: 0.05 } }),
      });
      const mexido = await (await fetch(`${base}/api/leads?porPagina=1`)).json();
      assert.notEqual(antes.itens[0].id, mexido.itens[0].id, 'o ICP alterado deveria mudar o ranking');

      const restaurado = await fetch(`${base}/api/demo/restaurar`, { method: 'POST' });
      assert.equal(restaurado.status, 200);

      const depois = await (await fetch(`${base}/api/leads?porPagina=1`)).json();
      assert.equal(depois.itens[0].id, antes.itens[0].id, 'deveria voltar ao ranking original');
      assert.equal(depois.total, antes.total);
    });
  });

  test('a rota de restaurar nao existe fora do modo demo', async () => {
    const repositorio = new Repositorio(':memory:');
    repositorio.salvarLeads(gerarCarteira({ quantidade: 5, semente: 'x' }));
    const servidor = criarServidor(repositorio, { log: false, senha: SENHA, segredoSessao: 'fixo' });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;

    const resposta = await fetch(`${base}/api/sessao`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: SENHA }),
    });
    const cookie = resposta.headers.getSetCookie()[0].split(';')[0];

    // Com sessao valida, ainda assim a rota nao existe: um painel de producao
    // nao pode ter um botao que apaga a carteira inteira.
    const restaurar = await fetch(`${base}/api/demo/restaurar`, { method: 'POST', headers: { cookie } });
    assert.equal(restaurar.status, 404);

    const modo = await (await fetch(`${base}/api/modo`, { headers: { cookie } })).json();
    assert.equal(modo.demo, false);

    await new Promise((r) => servidor.close(r));
    repositorio.fechar();
  });
});

describe('servidor sem protecao', () => {
  test('tudo fica acessivel quando nao ha senha (uso local)', async () => {
    const repositorio = new Repositorio(':memory:');
    repositorio.salvarLeads(gerarCarteira({ quantidade: 10, semente: 'aberto' }));
    const servidor = criarServidor(repositorio, { log: false, senha: null });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;

    assert.equal((await fetch(`${base}/api/leads`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
    const sessao = await (await fetch(`${base}/api/sessao`)).json();
    assert.equal(sessao.protecaoAtiva, false);

    await new Promise((r) => servidor.close(r));
    repositorio.fechar();
  });
});
