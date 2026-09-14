/**
 * Testes do motor de scoring.
 *
 * O foco esta nas propriedades que precisam valer sempre (monotonicidade,
 * limites, decaimento) e nas fronteiras de decisao -- nao em cravar numeros
 * magicos, que tornariam qualquer recalibracao do modelo uma quebra de teste.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  avaliarLead, calcularFit, calcularIntencao, calcularAcessibilidade,
  classificarTier, decaimento, proximidadeDeFaixa,
} from '../src/core/scoring.js';
import { normalizarIcp, ICP_PADRAO, ErroDeValidacao } from '../src/core/icp.js';

const HOJE = new Date('2026-09-14T00:00:00.000Z');
const ICP = normalizarIcp();

/** Lead de referencia: alto fit, contato decisor, sem sinais. */
function leadBase(sobrescritas = {}) {
  return {
    id: 'LD-TESTE',
    empresa: 'Empresa Teste',
    dominio: 'teste.com.br',
    setor: 'saas',
    funcionarios: 120,
    receitaAnual: 20_000_000,
    regiao: 'sudeste',
    tecnologias: ['rd-station', 'zapier'],
    maturidadeDigital: 4,
    contato: { nome: 'Ana Silva', cargo: 'head_vendas', email: 'ana@teste.com.br', telefone: '11', linkedin: 'x' },
    sinais: [],
    estagio: 'novo',
    ...sobrescritas,
  };
}

const diasAtras = (dias) => new Date(HOJE.getTime() - dias * 86_400_000).toISOString();

describe('proximidadeDeFaixa', () => {
  test('vale 1 dentro da faixa, inclusive nas bordas', () => {
    assert.equal(proximidadeDeFaixa(50, { min: 30, max: 300 }), 1);
    assert.equal(proximidadeDeFaixa(30, { min: 30, max: 300 }), 1);
    assert.equal(proximidadeDeFaixa(300, { min: 30, max: 300 }), 1);
  });

  test('decai fora da faixa em vez de zerar de uma vez', () => {
    const logoAcima = proximidadeDeFaixa(320, { min: 30, max: 300 });
    assert.ok(logoAcima > 0 && logoAcima < 1, `esperava valor entre 0 e 1, veio ${logoAcima}`);
    assert.ok(proximidadeDeFaixa(320, { min: 30, max: 300 }) > proximidadeDeFaixa(400, { min: 30, max: 300 }));
  });

  test('e continua na borda: 1 dentro, quase 1 logo fora', () => {
    const faixa = { min: 30, max: 300 };
    assert.equal(proximidadeDeFaixa(30, faixa), 1);
    assert.ok(proximidadeDeFaixa(29, faixa) > 0.96);
    assert.ok(proximidadeDeFaixa(301, faixa) > 0.99);
  });

  test('a queda e por razao, nao por diferenca absoluta', () => {
    // Uma empresa tres vezes menor que o minimo do ICP precisa pontuar perto de
    // um terco. Medindo por diferenca sobre a amplitude da faixa ela pontuaria
    // quase 90%, que e o erro que esta regra existe para evitar.
    const faixa = { min: 30, max: 300 };
    assert.ok(Math.abs(proximidadeDeFaixa(10, faixa) - 1 / 3) < 0.01);
    assert.ok(Math.abs(proximidadeDeFaixa(600, faixa) - 0.5) < 0.01);
  });

  test('nunca fica negativo, por mais distante que o valor esteja', () => {
    assert.ok(proximidadeDeFaixa(1e9, { min: 30, max: 300 }) < 0.001);
    assert.equal(proximidadeDeFaixa(0, { min: 30, max: 300 }), 0);
    assert.equal(proximidadeDeFaixa(-500, { min: 30, max: 300 }), 0);
  });

  test('e independente de unidade: mesma razao, mesma aderencia', () => {
    // E o que permite usar a mesma funcao para funcionarios e para reais sem
    // calibrar duas vezes.
    const emPessoas = proximidadeDeFaixa(600, { min: 30, max: 300 });
    const emReais = proximidadeDeFaixa(600_000_000, { min: 30_000_000, max: 300_000_000 });
    assert.equal(emPessoas.toFixed(9), emReais.toFixed(9));
  });

  test('faixa ancorada em zero usa a medida absoluta e nao quebra', () => {
    const valor = proximidadeDeFaixa(-50, { min: 0, max: 100 });
    assert.ok(valor >= 0 && valor <= 1);
  });
});

describe('decaimento', () => {
  test('na meia-vida sobra exatamente metade', () => {
    assert.equal(decaimento(10, 10), 0.5);
    assert.equal(decaimento(20, 10), 0.25);
  });

  test('sinal de hoje mantem o peso integral', () => {
    assert.equal(decaimento(0, 10), 1);
    assert.equal(decaimento(-5, 10), 1);
  });

  test('e estritamente decrescente no tempo', () => {
    let anterior = Infinity;
    for (const dias of [0, 1, 5, 10, 30, 90, 365]) {
      const atual = decaimento(dias, 14);
      assert.ok(atual < anterior, `${dias}d deveria valer menos que o ponto anterior`);
      anterior = atual;
    }
  });
});

describe('calcularFit', () => {
  test('lead alinhado ao ICP pontua alto', () => {
    const { score } = calcularFit(leadBase(), ICP);
    assert.ok(score > 80, `esperava fit acima de 80, veio ${score}`);
  });

  test('setor fora do ICP derruba o fit', () => {
    const dentro = calcularFit(leadBase(), ICP).score;
    const fora = calcularFit(leadBase({ setor: 'financeiro' }), ICP).score;
    assert.ok(fora < dentro, 'setor fora do ICP tinha de reduzir o fit');
  });

  test('tecnologia de bloqueio marca o lead como bloqueado', () => {
    const icp = normalizarIcp({ tecnologiasBloqueio: ['sap'] });
    const resultado = calcularFit(leadBase({ tecnologias: ['sap', 'rd-station'] }), icp);
    assert.equal(resultado.bloqueado, true);
  });

  test('a stack satura: a quinta tecnologia compativel acrescenta pouco', () => {
    const stack = ['rd-station', 'zapier', 'make', 'n8n', 'pipedrive'];
    const aderencia = (n) => calcularFit(leadBase({ tecnologias: stack.slice(0, n) }), ICP)
      .criterios.find((c) => c.id === 'tecnologia').aderencia;

    // Os ganhos precisam ser comparados passo a passo: 1->2 contra 4->5.
    const ganhos = [1, 2, 3, 4].map((n) => aderencia(n + 1) - aderencia(n));
    for (let i = 1; i < ganhos.length; i += 1) {
      assert.ok(ganhos[i] < ganhos[i - 1], `o ganho da tecnologia ${i + 2} nao diminuiu`);
    }
  });

  test('a soma das contribuicoes reproduz o score', () => {
    const { score, criterios } = calcularFit(leadBase(), ICP);
    const pesoTotal = criterios.reduce((soma, c) => soma + c.peso, 0);
    const bruto = criterios.reduce((soma, c) => soma + c.contribuicao, 0);
    assert.equal(Number(((bruto / pesoTotal) * 100).toFixed(1)), score);
  });

  test('todo criterio vem com detalhe legivel', () => {
    for (const criterio of calcularFit(leadBase(), ICP).criterios) {
      assert.ok(criterio.detalhe.length > 0, `criterio ${criterio.id} sem detalhe`);
    }
  });
});

describe('calcularIntencao', () => {
  test('lead sem sinais tem intencao zero', () => {
    assert.equal(calcularIntencao(leadBase(), HOJE).score, 0);
  });

  test('o mesmo sinal vale mais recente do que antigo', () => {
    const recente = calcularIntencao(leadBase({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(1) }] }), HOJE);
    const antigo = calcularIntencao(leadBase({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(60) }] }), HOJE);
    assert.ok(recente.score > antigo.score);
  });

  test('sinais desconhecidos sao ignorados sem quebrar', () => {
    const resultado = calcularIntencao(leadBase({
      sinais: [{ tipo: 'inexistente', data: diasAtras(1) }, { tipo: 'abriu_email', data: diasAtras(1) }],
    }), HOJE);
    assert.equal(resultado.sinais.length, 1);
    assert.equal(resultado.sinais[0].tipo, 'abriu_email');
  });

  test('a saturacao impede que muitos sinais fracos passem de 100', () => {
    const sinais = Array.from({ length: 40 }, () => ({ tipo: 'abriu_email', data: diasAtras(0) }));
    const { score } = calcularIntencao(leadBase({ sinais }), HOJE);
    assert.ok(score <= 100, `score estourou o limite: ${score}`);
    assert.ok(score > 90, 'quarenta sinais deveriam saturar perto do topo');
  });

  test('uma resposta pesa mais que varias aberturas de e-mail', () => {
    const resposta = calcularIntencao(leadBase({ sinais: [{ tipo: 'respondeu_email', data: diasAtras(0) }] }), HOJE);
    const aberturas = calcularIntencao(leadBase({
      sinais: Array.from({ length: 3 }, () => ({ tipo: 'abriu_email', data: diasAtras(0) })),
    }), HOJE);
    assert.ok(resposta.score > aberturas.score);
  });

  test('os sinais saem ordenados por contribuicao', () => {
    const { sinais } = calcularIntencao(leadBase({
      sinais: [
        { tipo: 'abriu_email', data: diasAtras(0) },
        { tipo: 'demo_solicitada', data: diasAtras(0) },
        { tipo: 'baixou_material', data: diasAtras(0) },
      ],
    }), HOJE);
    assert.equal(sinais[0].tipo, 'demo_solicitada');
    for (let i = 1; i < sinais.length; i += 1) {
      assert.ok(sinais[i - 1].contribuicao >= sinais[i].contribuicao);
    }
  });
});

describe('calcularAcessibilidade', () => {
  test('decisor com todos os canais pontua mais que analista sem canal', () => {
    const bom = calcularAcessibilidade(leadBase(), ICP).score;
    const ruim = calcularAcessibilidade(leadBase({
      contato: { nome: 'X', cargo: 'analista', email: null, telefone: null, linkedin: null },
    }), ICP).score;
    assert.ok(bom > ruim);
  });

  test('cargo fora dos alvos e sinalizado', () => {
    const resultado = calcularAcessibilidade(leadBase({ contato: { cargo: 'analista', email: 'a@b.c' } }), ICP);
    assert.equal(resultado.cargoNoAlvo, false);
  });

  test('contato ausente nao quebra o calculo', () => {
    const resultado = calcularAcessibilidade({ ...leadBase(), contato: undefined }, ICP);
    assert.ok(resultado.score >= 0 && resultado.score <= 100);
    assert.equal(resultado.canaisAtivos, 0);
  });
});

describe('classificarTier', () => {
  test('respeita os cortes configurados, inclusive nas bordas', () => {
    const tiers = { A: 78, B: 62, C: 45 };
    assert.equal(classificarTier(78, tiers), 'A');
    assert.equal(classificarTier(77.9, tiers), 'B');
    assert.equal(classificarTier(62, tiers), 'B');
    assert.equal(classificarTier(45, tiers), 'C');
    assert.equal(classificarTier(44.9, tiers), 'D');
  });
});

describe('avaliarLead', () => {
  test('o score final e a media ponderada das tres dimensoes', () => {
    const resultado = avaliarLead(leadBase({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(2) }] }), ICP, HOJE);
    const { fit, intencao, acessibilidade } = resultado.dimensoes;
    const esperado = fit.score * ICP.composicao.fit
      + intencao.score * ICP.composicao.intencao
      + acessibilidade.score * ICP.composicao.acessibilidade;
    assert.equal(resultado.score, Number(esperado.toFixed(1)));
  });

  test('o bloqueio e eliminatorio: intencao alta nao salva o lead', () => {
    const icp = normalizarIcp({ tecnologiasBloqueio: ['sap'] });
    const resultado = avaliarLead(leadBase({
      tecnologias: ['sap'],
      sinais: Array.from({ length: 6 }, () => ({ tipo: 'demo_solicitada', data: diasAtras(0) })),
    }), icp, HOJE);
    assert.equal(resultado.bloqueado, true);
    assert.ok(resultado.score <= 25, `lead bloqueado nao pode pontuar ${resultado.score}`);
    assert.equal(resultado.motivos[0].tipo, 'bloqueio');
  });

  test('o score fica sempre no intervalo 0-100', () => {
    const extremos = [
      leadBase({ funcionarios: 1, receitaAnual: 0, maturidadeDigital: 1, tecnologias: [], setor: 'agro', regiao: 'norte', contato: {} }),
      leadBase({ funcionarios: 99_999, receitaAnual: 9e12, maturidadeDigital: 5 }),
      leadBase({ sinais: Array.from({ length: 50 }, () => ({ tipo: 'demo_solicitada', data: diasAtras(0) })) }),
    ];
    for (const lead of extremos) {
      const { score } = avaliarLead(lead, ICP, HOJE);
      assert.ok(score >= 0 && score <= 100, `score fora do intervalo: ${score}`);
    }
  });

  test('e deterministico: a mesma entrada da o mesmo resultado', () => {
    const lead = leadBase({ sinais: [{ tipo: 'vaga_aberta', data: diasAtras(10) }] });
    assert.deepEqual(avaliarLead(lead, ICP, HOJE), avaliarLead(lead, ICP, HOJE));
  });

  test('sempre produz pelo menos uma justificativa', () => {
    assert.ok(avaliarLead(leadBase(), ICP, HOJE).motivos.length > 0);
  });

  test('lead sem sinal nenhum recebe alerta de abordagem fria', () => {
    const { motivos } = avaliarLead(leadBase(), ICP, HOJE);
    assert.ok(motivos.some((m) => m.texto.includes('fria')));
  });
});

describe('normalizarIcp', () => {
  test('completa os campos ausentes com o padrao', () => {
    const icp = normalizarIcp({ nome: 'Meu ICP' });
    assert.equal(icp.nome, 'Meu ICP');
    assert.deepEqual(icp.pesos, ICP_PADRAO.pesos);
  });

  test('acusa todos os problemas de uma vez', () => {
    assert.throws(
      () => normalizarIcp({ setoresAlvo: ['fantasma'], tiers: { A: 10, B: 50, C: 80 } }),
      (erro) => {
        assert.ok(erro instanceof ErroDeValidacao);
        assert.equal(erro.problemas.length, 2);
        return true;
      });
  });

  test('rejeita composicao que nao soma 1', () => {
    assert.throws(() => normalizarIcp({ composicao: { fit: 0.5, intencao: 0.5, acessibilidade: 0.5 } }), ErroDeValidacao);
  });

  test('rejeita tecnologia que e alvo e bloqueio ao mesmo tempo', () => {
    assert.throws(() => normalizarIcp({ tecnologiasBloqueio: ['hubspot'] }), ErroDeValidacao);
  });

  test('o resultado e imutavel', () => {
    const icp = normalizarIcp();
    assert.throws(() => { icp.nome = 'outro'; }, TypeError);
  });
});
