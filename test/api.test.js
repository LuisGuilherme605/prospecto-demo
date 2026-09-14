/**
 * Testes de persistencia e da API HTTP.
 *
 * O servidor sobe de verdade em porta efemera e as requisicoes sao feitas com
 * fetch: o que esta sendo testado e o comportamento observavel do sistema, nao
 * um mock do proprio codigo.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { Repositorio } from '../src/store/repositorio.js';
import { criarServidor } from '../src/server/servidor.js';
import { gerarCarteira } from '../src/data/gerador.js';
import { Roteador } from '../src/server/roteador.js';

const REF = new Date('2026-09-14T00:00:00.000Z');

describe('Roteador', () => {
  test('casa rota estatica e extrai parametro de caminho', () => {
    const roteador = new Roteador();
    roteador.get('/api/leads', () => 'lista');
    roteador.get('/api/leads/:id', (ctx) => ctx.parametros.id);

    assert.equal(roteador.resolver('GET', '/api/leads').manipulador(), 'lista');
    const rota = roteador.resolver('GET', '/api/leads/LD-42');
    assert.equal(rota.parametros.id, 'LD-42');
  });

  test('decodifica parametro com caractere especial', () => {
    const roteador = new Roteador();
    roteador.get('/api/x/:nome', (ctx) => ctx.parametros.nome);
    assert.equal(roteador.resolver('GET', '/api/x/a%20b').parametros.nome, 'a b');
  });

  test('distingue o metodo HTTP', () => {
    const roteador = new Roteador();
    roteador.get('/api/x', () => 'get');
    assert.equal(roteador.resolver('POST', '/api/x'), null);
  });

  test('rota inexistente devolve null', () => {
    assert.equal(new Roteador().resolver('GET', '/nada'), null);
  });
});

describe('Repositorio', () => {
  let repositorio;

  before(() => {
    repositorio = new Repositorio(':memory:');
    repositorio.salvarLeads(gerarCarteira({ quantidade: 80, semente: 'repo', referencia: REF }));
  });

  after(() => repositorio.fechar());

  test('salva e conta os leads', () => {
    assert.equal(repositorio.contarLeads(), 80);
  });

  test('preserva os campos na ida e volta do banco', () => {
    const original = gerarCarteira({ quantidade: 1, semente: 'ida-volta', referencia: REF })[0];
    const repo = new Repositorio(':memory:');
    repo.salvarLeads([original]);
    const lido = repo.buscarLead(original.id);

    assert.equal(lido.empresa, original.empresa);
    assert.equal(lido.funcionarios, original.funcionarios);
    assert.deepEqual(lido.tecnologias, original.tecnologias);
    assert.deepEqual(lido.contato, original.contato);
    assert.equal(lido.sinais.length, original.sinais.length);
    repo.fechar();
  });

  test('salvar de novo atualiza em vez de duplicar', () => {
    const leads = gerarCarteira({ quantidade: 5, semente: 'upsert', referencia: REF });
    const repo = new Repositorio(':memory:');
    repo.salvarLeads(leads);
    repo.salvarLeads(leads.map((l) => ({ ...l, empresa: `${l.empresa} (atualizada)` })));

    assert.equal(repo.contarLeads(), 5);
    assert.match(repo.buscarLead(leads[0].id).empresa, /atualizada/);
    repo.fechar();
  });

  test('filtra por setor, estagio e busca textual', () => {
    assert.ok(repositorio.listarLeads({ setor: 'saas' }).every((l) => l.setor === 'saas'));
    assert.ok(repositorio.listarLeads({ estagio: 'novo' }).every((l) => l.estagio === 'novo'));

    const alvo = repositorio.listarLeads({ limite: 1 })[0];
    const encontrados = repositorio.listarLeads({ busca: alvo.empresa.slice(0, 6).toLowerCase() });
    assert.ok(encontrados.some((l) => l.id === alvo.id));
  });

  test('pagina com limite e offset sem sobreposicao', () => {
    const primeira = repositorio.listarLeads({ limite: 10, offset: 0 });
    const segunda = repositorio.listarLeads({ limite: 10, offset: 10 });
    assert.equal(primeira.length, 10);
    assert.equal(new Set([...primeira, ...segunda].map((l) => l.id)).size, 20);
  });

  test('lead inexistente devolve null em vez de lancar', () => {
    assert.equal(repositorio.buscarLead('NAO-EXISTE'), null);
    assert.equal(repositorio.atualizarEstagio('NAO-EXISTE', 'reuniao'), null);
    assert.equal(repositorio.registrarSinal('NAO-EXISTE', 'abriu_email'), null);
  });

  test('mudanca de estagio grava evento na linha do tempo', () => {
    const alvo = repositorio.listarLeads({ limite: 1 })[0];
    repositorio.atualizarEstagio(alvo.id, 'reuniao');
    assert.equal(repositorio.buscarLead(alvo.id).estagio, 'reuniao');
    assert.ok(repositorio.listarEventos(alvo.id).some((e) => e.tipo === 'mudanca_estagio'));
  });

  test('registrar sinal acrescenta na frente da lista', () => {
    const alvo = repositorio.listarLeads({ limite: 1, offset: 3 })[0];
    const antes = alvo.sinais.length;
    const depois = repositorio.registrarSinal(alvo.id, 'demo_solicitada', REF.toISOString());
    assert.equal(depois.sinais.length, antes + 1);
    assert.equal(depois.sinais[0].tipo, 'demo_solicitada');
  });

  test('ICP cai no padrao quando nada foi salvo', () => {
    const repo = new Repositorio(':memory:');
    assert.ok(repo.obterIcp().setoresAlvo.length > 0);
    repo.fechar();
  });

  test('ICP salvo e recuperado normalizado', () => {
    const repo = new Repositorio(':memory:');
    repo.salvarIcp({ nome: 'ICP de teste', setoresAlvo: ['industria'] });
    const lido = repo.obterIcp();
    assert.equal(lido.nome, 'ICP de teste');
    assert.deepEqual(lido.setoresAlvo, ['industria']);
    repo.fechar();
  });

  test('ICP invalido e rejeitado na escrita', () => {
    const repo = new Repositorio(':memory:');
    assert.throws(() => repo.salvarIcp({ setoresAlvo: ['inexistente'] }));
    repo.fechar();
  });
});

describe('API HTTP', () => {
  let servidor;
  let repositorio;
  let base;

  before(async () => {
    repositorio = new Repositorio(':memory:');
    repositorio.salvarLeads(gerarCarteira({ quantidade: 120, semente: 'api', referencia: REF }));
    servidor = criarServidor(repositorio, { log: false, referencia: REF });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    await new Promise((resolver) => servidor.close(resolver));
    repositorio.fechar();
  });

  const pegar = async (caminho, opcoes) => {
    const resposta = await fetch(`${base}${caminho}`, opcoes);
    return { status: resposta.status, dados: await resposta.json(), resposta };
  };

  test('GET /api/saude responde ok com a contagem', async () => {
    const { status, dados } = await pegar('/api/saude');
    assert.equal(status, 200);
    assert.equal(dados.status, 'ok');
    assert.equal(dados.leads, 120);
  });

  test('GET /api/leads pagina e ordena por prioridade', async () => {
    const { dados } = await pegar('/api/leads?porPagina=10');
    assert.equal(dados.itens.length, 10);
    assert.equal(dados.total, 120);
    assert.equal(dados.itens[0].posicao, 1);
    for (let i = 1; i < dados.itens.length; i += 1) {
      assert.ok(dados.itens[i - 1].scorePrioridade >= dados.itens[i].scorePrioridade);
    }
  });

  test('GET /api/leads aplica os filtros', async () => {
    const { dados } = await pegar('/api/leads?tier=A&porPagina=100');
    assert.ok(dados.itens.every((l) => l.tier === 'A'));

    const { dados: porSetor } = await pegar('/api/leads?setor=saas&porPagina=100');
    assert.ok(porSetor.itens.every((l) => l.setor === 'saas'));
  });

  test('GET /api/leads/:id traz o breakdown completo', async () => {
    const { dados: lista } = await pegar('/api/leads?porPagina=1');
    const { status, dados } = await pegar(`/api/leads/${lista.itens[0].id}`);
    assert.equal(status, 200);
    assert.ok(dados.avaliacao.dimensoes.fit.criterios.length > 0);
    assert.ok(dados.avaliacao.motivos.length > 0);
  });

  test('GET /api/leads/:id inexistente responde 404 com mensagem', async () => {
    const { status, dados } = await pegar('/api/leads/NAO-EXISTE');
    assert.equal(status, 404);
    assert.match(dados.erro, /nao encontrado/);
  });

  test('GET /api/fila respeita a capacidade', async () => {
    const { dados } = await pegar('/api/fila?capacidade=12');
    assert.ok(dados.length <= 12);
  });

  test('GET /api/previsao com meta traz o diagnostico', async () => {
    const { dados } = await pegar('/api/previsao?meta=1000000');
    assert.ok(dados.cenarios.conservador <= dados.cenarios.base);
    assert.ok(dados.meta.diagnostico.length > 0);
  });

  test('POST /api/leads/:id/cadencia gera a sequencia', async () => {
    const { dados: lista } = await pegar('/api/leads?porPagina=1');
    const { status, dados } = await pegar(`/api/leads/${lista.itens[0].id}/cadencia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remetente: 'Luis Guilherme' }),
    });
    assert.equal(status, 200);
    assert.ok(dados.toques.length > 0);
    assert.match(dados.toques[0].corpo, /Luis Guilherme/);
  });

  test('PATCH de estagio invalido responde 422 listando os validos', async () => {
    const { dados: lista } = await pegar('/api/leads?porPagina=1');
    const { status, dados } = await pegar(`/api/leads/${lista.itens[0].id}/estagio`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estagio: 'inventado' }),
    });
    assert.equal(status, 422);
    assert.ok(dados.detalhes.validos.includes('reuniao'));
  });

  test('POST de sinal recalcula o score do lead', async () => {
    const { dados: lista } = await pegar('/api/leads?tier=C&porPagina=1');
    const alvo = lista.itens[0];
    const { status, dados } = await pegar(`/api/leads/${alvo.id}/sinais`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'demo_solicitada', data: REF.toISOString() }),
    });
    assert.equal(status, 200);
    assert.ok(dados.avaliacao.dimensoes.intencao.score > alvo.dimensoes.intencao,
      'um pedido de demo deveria elevar a intencao');
  });

  test('sinal desconhecido responde 422', async () => {
    const { dados: lista } = await pegar('/api/leads?porPagina=1');
    const { status } = await pegar(`/api/leads/${lista.itens[0].id}/sinais`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'sinal_fantasma' }),
    });
    assert.equal(status, 422);
  });

  test('PUT /api/icp invalido responde 422 com a lista de problemas', async () => {
    const { status, dados } = await pegar('/api/icp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ composicao: { fit: 0.9, intencao: 0.9, acessibilidade: 0.9 } }),
    });
    assert.equal(status, 422);
    assert.ok(Array.isArray(dados.detalhes));
  });

  test('PUT /api/icp valido repriorizr a carteira', async () => {
    const { dados: antes } = await pegar('/api/leads?porPagina=100');
    await pegar('/api/icp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setoresAlvo: ['agro', 'industria', 'construcao'] }),
    });
    const { dados: depois } = await pegar('/api/leads?porPagina=100');
    assert.notDeepEqual(antes.itens.map((l) => l.id), depois.itens.map((l) => l.id));

    // Devolve o ICP ao padrao para nao contaminar os testes seguintes.
    await pegar('/api/icp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setoresAlvo: ['saas', 'ecommerce', 'servicos', 'saude', 'logistica'] }),
    });
  });

  test('GET /api/exportar.csv devolve CSV com cabecalho', async () => {
    const resposta = await fetch(`${base}/api/exportar.csv?tier=A`);
    assert.equal(resposta.status, 200);
    assert.match(resposta.headers.get('content-type'), /text\/csv/);
    assert.match(resposta.headers.get('content-disposition'), /attachment/);
    const texto = await resposta.text();
    assert.match(texto.split('\n')[0], /empresa/);
  });

  test('corpo com JSON invalido responde 400', async () => {
    const resposta = await fetch(`${base}/api/icp`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{isso nao e json',
    });
    assert.equal(resposta.status, 400);
  });

  test('rota inexistente responde 404 em JSON', async () => {
    const { status, dados } = await pegar('/api/rota-que-nao-existe');
    assert.equal(status, 404);
    assert.ok(dados.erro);
  });

  test('serve o painel na raiz', async () => {
    const resposta = await fetch(`${base}/`);
    assert.equal(resposta.status, 200);
    assert.match(resposta.headers.get('content-type'), /text\/html/);
    assert.match(await resposta.text(), /Prospecto/);
  });

  test('bloqueia travessia de diretorio', async () => {
    for (const caminho of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
      const resposta = await fetch(`${base}${caminho}`);
      assert.ok(resposta.status >= 400, `${caminho} deveria ser bloqueado, veio ${resposta.status}`);
      assert.doesNotMatch(await resposta.text(), /"name": "prospecto"/);
    }
  });

  test('envia cabecalho anti-sniffing de tipo', async () => {
    const resposta = await fetch(`${base}/api/saude`);
    assert.equal(resposta.headers.get('x-content-type-options'), 'nosniff');
  });
});
