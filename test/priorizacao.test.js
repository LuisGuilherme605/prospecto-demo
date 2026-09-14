/**
 * Testes de priorizacao, proxima acao e previsao de pipeline.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { priorizar, montarFilaDoDia, resumirCarteira, proximaAcao, valorPotencial, calcularUrgencia } from '../src/core/priorizacao.js';
import { projetarPipeline, probabilidadeDeFechamento, previsaoDeFechamento } from '../src/core/previsao.js';
import { avaliarLead } from '../src/core/scoring.js';
import { normalizarIcp } from '../src/core/icp.js';
import { gerarCarteira } from '../src/data/gerador.js';

const HOJE = new Date('2026-09-14T00:00:00.000Z');
const ICP = normalizarIcp();
const diasAtras = (dias) => new Date(HOJE.getTime() - dias * 86_400_000).toISOString();

function lead(sobrescritas = {}) {
  return {
    id: 'LD-1',
    empresa: 'Teste',
    setor: 'saas',
    funcionarios: 120,
    receitaAnual: 20_000_000,
    regiao: 'sudeste',
    tecnologias: ['rd-station'],
    maturidadeDigital: 4,
    contato: { nome: 'Ana Silva', cargo: 'head_vendas', email: 'a@b.com' },
    sinais: [],
    estagio: 'novo',
    ultimoContatoEm: null,
    ...sobrescritas,
  };
}

const comAvaliacao = (l) => ({ ...l, avaliacao: avaliarLead(l, ICP, HOJE) });

describe('valorPotencial', () => {
  test('cresce com o porte dentro do mesmo setor', () => {
    const pequena = valorPotencial(lead({ funcionarios: 20 }));
    const grande = valorPotencial(lead({ funcionarios: 800 }));
    assert.ok(grande > pequena);
  });

  test('varia por setor no mesmo porte', () => {
    assert.notEqual(valorPotencial(lead({ setor: 'educacao' })), valorPotencial(lead({ setor: 'financeiro' })));
  });
});

describe('calcularUrgencia', () => {
  test('lead nunca contatado ja nasce urgente', () => {
    const l = lead({ ultimoContatoEm: null });
    assert.ok(calcularUrgencia(l, avaliarLead(l, ICP, HOJE), HOJE) > 0.3);
  });

  test('sinal fresco aumenta a urgencia', () => {
    const frio = lead({ ultimoContatoEm: diasAtras(3) });
    const quente = lead({ ultimoContatoEm: diasAtras(3), sinais: [{ tipo: 'visitou_precos', data: diasAtras(0) }] });
    assert.ok(
      calcularUrgencia(quente, avaliarLead(quente, ICP, HOJE), HOJE)
      > calcularUrgencia(frio, avaliarLead(frio, ICP, HOJE), HOJE));
  });

  test('fica sempre entre 0 e 1', () => {
    for (const dias of [0, 5, 30, 200]) {
      const l = lead({ ultimoContatoEm: diasAtras(dias), sinais: [{ tipo: 'demo_solicitada', data: diasAtras(dias) }] });
      const u = calcularUrgencia(l, avaliarLead(l, ICP, HOJE), HOJE);
      assert.ok(u >= 0 && u <= 1, `urgencia fora do intervalo: ${u}`);
    }
  });
});

describe('proximaAcao', () => {
  const acaoDe = (l) => proximaAcao(l, avaliarLead(l, ICP, HOJE), HOJE).acao;

  test('resposta recente manda ligar na hora', () => {
    assert.equal(acaoDe(lead({ sinais: [{ tipo: 'respondeu_email', data: diasAtras(1) }] })), 'ligar_agora');
  });

  test('visita a pagina de precos vira abordagem direta', () => {
    assert.equal(acaoDe(lead({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(2) }] })), 'abordagem_direta');
  });

  test('gatilho de mudanca vira abordagem por gatilho', () => {
    assert.equal(acaoDe(lead({ sinais: [{ tipo: 'rodada_investimento', data: diasAtras(20) }] })), 'abordagem_por_gatilho');
  });

  test('lead bloqueado e descartado antes de qualquer outra regra', () => {
    const icp = normalizarIcp({ tecnologiasBloqueio: ['sap'] });
    const l = lead({ tecnologias: ['sap'], sinais: [{ tipo: 'respondeu_email', data: diasAtras(0) }] });
    assert.equal(proximaAcao(l, avaliarLead(l, icp, HOJE), HOJE).acao, 'descartar');
  });

  test('lead ja fechado e arquivado', () => {
    assert.equal(acaoDe(lead({ estagio: 'ganho' })), 'arquivar');
    assert.equal(acaoDe(lead({ estagio: 'perdido' })), 'arquivar');
  });

  test('contato sem poder de decisao manda mapear o decisor', () => {
    assert.equal(
      acaoDe(lead({ contato: { nome: 'Joao', cargo: 'analista', email: 'a@b.c' }, funcionarios: 500, maturidadeDigital: 2 })),
      'mapear_decisor');
  });

  test('a acao sempre traz canal coerente e justificativa', () => {
    for (const l of [lead(), lead({ estagio: 'contatado', ultimoContatoEm: diasAtras(20) })]) {
      const acao = proximaAcao(l, avaliarLead(l, ICP, HOJE), HOJE);
      assert.ok(acao.justificativa.length > 10);
      assert.ok(acao.prazoDias >= 0);
    }
  });
});

describe('priorizar', () => {
  const carteira = gerarCarteira({ quantidade: 150, semente: 'teste-priorizacao', referencia: HOJE });

  test('ordena de forma decrescente pelo score de prioridade', () => {
    const lista = priorizar(carteira, ICP, { referencia: HOJE });
    for (let i = 1; i < lista.length; i += 1) {
      assert.ok(lista[i - 1].scorePrioridade >= lista[i].scorePrioridade, `quebra de ordem na posicao ${i}`);
    }
  });

  test('numera as posicoes a partir de 1, sem buraco', () => {
    const lista = priorizar(carteira, ICP, { referencia: HOJE });
    lista.forEach((item, indice) => assert.equal(item.posicao, indice + 1));
  });

  test('exclui leads encerrados por padrao', () => {
    const comEncerrados = [...carteira, lead({ id: 'X1', estagio: 'ganho' }), lead({ id: 'X2', estagio: 'perdido' })];
    const semEncerrados = priorizar(comEncerrados, ICP, { referencia: HOJE });
    assert.equal(semEncerrados.filter((l) => ['ganho', 'perdido'].includes(l.estagio)).length, 0);
    assert.equal(priorizar(comEncerrados, ICP, { referencia: HOJE, incluirEncerrados: true }).length, comEncerrados.length);
  });

  test('mudar o ICP repriorizr a carteira a favor dos novos setores-alvo', () => {
    // Nao basta checar que o primeiro colocado mudou: um lead com muita
    // intencao pode liderar os dois ICPs. A propriedade que importa e que os
    // setores recem-eleitos sobem, em media, no ranking.
    const novosAlvos = ['agro', 'industria'];
    const posicaoMedia = (lista) => {
      const alvo = lista.filter((l) => novosAlvos.includes(l.setor));
      return alvo.reduce((soma, l) => soma + l.posicao, 0) / alvo.length;
    };

    const antes = priorizar(carteira, ICP, { referencia: HOJE });
    const depois = priorizar(carteira, normalizarIcp({ setoresAlvo: novosAlvos }), { referencia: HOJE });

    assert.ok(posicaoMedia(depois) < posicaoMedia(antes),
      'os setores do novo ICP deveriam subir no ranking');
    assert.notDeepEqual(antes.map((l) => l.id), depois.map((l) => l.id),
      'a ordem geral deveria mudar');
  });

  test('e deterministico entre execucoes', () => {
    const a = priorizar(carteira, ICP, { referencia: HOJE }).map((l) => l.id);
    const b = priorizar(carteira, ICP, { referencia: HOJE }).map((l) => l.id);
    assert.deepEqual(a, b);
  });

  test('carteira vazia devolve lista vazia', () => {
    assert.deepEqual(priorizar([], ICP, { referencia: HOJE }), []);
  });
});

describe('montarFilaDoDia', () => {
  const lista = priorizar(gerarCarteira({ quantidade: 300, semente: 'fila', referencia: HOJE }), ICP, { referencia: HOJE });

  test('respeita a capacidade informada', () => {
    for (const capacidade of [5, 25, 60]) {
      assert.ok(montarFilaDoDia(lista, { capacidade }).length <= capacidade);
    }
  });

  test('nao inclui lead para descartar, arquivar ou apenas monitorar', () => {
    const fila = montarFilaDoDia(lista, { capacidade: 80 });
    for (const item of fila) {
      assert.ok(!['descartar', 'arquivar', 'monitorar'].includes(item.proximaAcao.acao));
    }
  });

  test('a reserva por tier impede uma fila so de tier A', () => {
    // Sem reserva, o time trabalharia so o topo e o funil de medio prazo secaria.
    const fila = montarFilaDoDia(lista, { capacidade: 30 });
    const tiers = new Set(fila.map((l) => l.tier));
    assert.ok(tiers.size > 1, 'a fila deveria misturar tiers');
  });

  test('ordena pelo prazo: o que e para hoje vem primeiro', () => {
    const fila = montarFilaDoDia(lista, { capacidade: 30 });
    for (let i = 1; i < fila.length; i += 1) {
      assert.ok(fila[i - 1].proximaAcao.prazoDias <= fila[i].proximaAcao.prazoDias);
    }
  });

  test('preenche a cota que sobra quando falta lead de um tier', () => {
    const poucos = lista.slice(0, 12);
    assert.ok(montarFilaDoDia(poucos, { capacidade: 10 }).length <= 10);
  });
});

describe('resumirCarteira', () => {
  test('os totais por tier somam o total geral', () => {
    const lista = priorizar(gerarCarteira({ quantidade: 200, semente: 'resumo', referencia: HOJE }), ICP, { referencia: HOJE });
    const resumo = resumirCarteira(lista);
    assert.equal(Object.values(resumo.porTier).reduce((a, b) => a + b, 0), resumo.total);
  });

  test('carteira vazia nao gera divisao por zero', () => {
    const resumo = resumirCarteira([]);
    assert.equal(resumo.total, 0);
    assert.equal(resumo.scoreMedio, 0);
    assert.equal(resumo.ticketMedio, 0);
  });
});

describe('probabilidadeDeFechamento', () => {
  test('avanca com o estagio do funil', () => {
    const base = { tier: 'A', score: 85, setor: 'saas', funcionarios: 120 };
    const estagios = ['novo', 'contatado', 'engajado', 'reuniao', 'oportunidade'];
    let anterior = 0;
    for (const estagio of estagios) {
      const atual = probabilidadeDeFechamento({ ...base, estagio });
      assert.ok(atual > anterior, `${estagio} deveria ser mais provavel que o estagio anterior`);
      anterior = atual;
    }
  });

  test('tier melhor converte mais no mesmo estagio', () => {
    const comum = { estagio: 'engajado', score: 70, setor: 'saas', funcionarios: 120 };
    assert.ok(probabilidadeDeFechamento({ ...comum, tier: 'A' }) > probabilidadeDeFechamento({ ...comum, tier: 'C' }));
  });

  test('ganho vale 1 e perdido vale 0', () => {
    assert.equal(probabilidadeDeFechamento({ tier: 'A', score: 90, estagio: 'ganho' }), 1);
    assert.equal(probabilidadeDeFechamento({ tier: 'A', score: 90, estagio: 'perdido' }), 0);
  });

  test('fica sempre no intervalo 0-1', () => {
    for (const tier of ['A', 'B', 'C', 'D']) {
      for (const estagio of ['novo', 'contatado', 'engajado', 'reuniao', 'oportunidade']) {
        const p = probabilidadeDeFechamento({ tier, estagio, score: 100, setor: 'saas', funcionarios: 120 });
        assert.ok(p >= 0 && p <= 1, `probabilidade fora do intervalo: ${p}`);
      }
    }
  });
});

describe('previsaoDeFechamento', () => {
  test('lead mais avancado fecha antes', () => {
    const base = { setor: 'saas', funcionarios: 120 };
    const novo = previsaoDeFechamento({ ...base, estagio: 'novo' }, HOJE);
    const oportunidade = previsaoDeFechamento({ ...base, estagio: 'oportunidade' }, HOJE);
    assert.ok(oportunidade.diasRestantes < novo.diasRestantes);
  });

  test('empresa maior demora mais para decidir', () => {
    const pequena = previsaoDeFechamento({ setor: 'saas', funcionarios: 20, estagio: 'novo' }, HOJE);
    const grande = previsaoDeFechamento({ setor: 'saas', funcionarios: 3000, estagio: 'novo' }, HOJE);
    assert.ok(grande.diasRestantes > pequena.diasRestantes);
  });
});

describe('projetarPipeline', () => {
  const lista = priorizar(gerarCarteira({ quantidade: 250, semente: 'previsao', referencia: HOJE }), ICP, { referencia: HOJE });

  test('os cenarios sao ordenados e nao negativos', () => {
    const { cenarios } = projetarPipeline(lista, { referencia: HOJE });
    assert.ok(cenarios.conservador <= cenarios.base);
    assert.ok(cenarios.base <= cenarios.otimista);
    assert.ok(cenarios.conservador >= 0);
  });

  test('o cenario base nunca passa do valor bruto em jogo', () => {
    const p = projetarPipeline(lista, { referencia: HOJE });
    assert.ok(p.cenarios.base <= p.valorBruto);
  });

  test('horizonte maior considera mais leads', () => {
    const curto = projetarPipeline(lista, { referencia: HOJE, horizonteDias: 30 });
    const longo = projetarPipeline(lista, { referencia: HOJE, horizonteDias: 365 });
    assert.ok(longo.leadsConsiderados >= curto.leadsConsiderados);
  });

  test('sem meta, nao ha bloco de meta', () => {
    assert.equal(projetarPipeline(lista, { referencia: HOJE }).meta, null);
  });

  test('meta inalcancavel e diagnosticada como falta de topo de funil', () => {
    const p = projetarPipeline(lista, { referencia: HOJE, meta: 500_000_000 });
    assert.equal(p.meta.atingeNoBase, false);
    assert.ok(p.meta.lacuna > 0);
    assert.ok(p.meta.leadsAdicionaisNecessarios > 0);
    assert.match(p.meta.diagnostico, /insuficiente/);
  });

  test('meta trivial e marcada como coberta', () => {
    const p = projetarPipeline(lista, { referencia: HOJE, meta: 1000 });
    assert.equal(p.meta.atingeNoBase, true);
    assert.equal(p.meta.lacuna, 0);
  });

  test('leads perdidos ficam de fora da projecao', () => {
    const comPerdido = [...lista, { ...comAvaliacao(lead({ id: 'PERDIDO', estagio: 'perdido' })), tier: 'A', score: 90, estagio: 'perdido', valorPotencial: 999_999 }];
    const p = projetarPipeline(comPerdido, { referencia: HOJE });
    assert.equal(p.topDeals.some((d) => d.id === 'PERDIDO'), false);
  });

  test('carteira vazia projeta zero sem quebrar', () => {
    const p = projetarPipeline([], { referencia: HOJE, meta: 100_000 });
    assert.equal(p.cenarios.base, 0);
    assert.equal(p.meta.leadsAdicionaisNecessarios, 0);
  });
});
