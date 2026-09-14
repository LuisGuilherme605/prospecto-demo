/**
 * Testes do gerador de cadencia.
 *
 * O que precisa ser garantido aqui e que o texto que chega ao vendedor nunca
 * saia com placeholder vazado, nunca cite um gatilho que nao aconteceu e sempre
 * corresponda ao esforco que o tier justifica.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gerarCadencia, preencher, TRILHAS } from '../src/core/cadencia.js';
import { avaliarLead } from '../src/core/scoring.js';
import { normalizarIcp } from '../src/core/icp.js';
import { gerarCarteira } from '../src/data/gerador.js';
import { priorizar } from '../src/core/priorizacao.js';

const HOJE = new Date('2026-09-14T00:00:00.000Z');
const ICP = normalizarIcp();
const diasAtras = (dias) => new Date(HOJE.getTime() - dias * 86_400_000).toISOString();

function leadAvaliado(sobrescritas = {}) {
  const lead = {
    id: 'LD-1',
    empresa: 'Acme Solucoes',
    setor: 'saas',
    funcionarios: 120,
    receitaAnual: 20_000_000,
    regiao: 'sudeste',
    tecnologias: ['rd-station'],
    maturidadeDigital: 4,
    contato: { nome: 'Ana Silva', cargo: 'head_vendas', email: 'ana@acme.com', telefone: '11', linkedin: 'x' },
    sinais: [],
    estagio: 'novo',
    ultimoContatoEm: null,
    ...sobrescritas,
  };
  return { ...lead, avaliacao: avaliarLead(lead, ICP, HOJE) };
}

const gerar = (lead, opcoes = {}) => gerarCadencia(lead, { referencia: HOJE, remetente: 'Luis', empresaRemetente: 'Prospecto', ...opcoes });

describe('preencher', () => {
  test('substitui as variaveis conhecidas', () => {
    assert.equal(preencher('Oi {{nome}}, da {{empresa}}', { nome: 'Ana', empresa: 'Acme' }), 'Oi Ana, da Acme');
  });

  test('deixa visivel o placeholder desconhecido em vez de apagar', () => {
    // Um buraco vazio no texto passa despercebido na revisao; o placeholder
    // intacto denuncia o problema.
    assert.equal(preencher('Oi {{faltando}}', {}), 'Oi {{faltando}}');
  });
});

describe('escolha de trilha', () => {
  const trilhaDe = (lead) => gerar(lead).trilha.id;

  test('visita a pagina de precos leva a trilha de precificacao', () => {
    assert.equal(trilhaDe(leadAvaliado({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(2) }] })), 'pos_precificacao');
  });

  test('vaga aberta leva a trilha de crescimento', () => {
    assert.equal(trilhaDe(leadAvaliado({ sinais: [{ tipo: 'vaga_aberta', data: diasAtras(10) }] })), 'crescimento_time');
  });

  test('captacao leva a trilha de novo capital', () => {
    assert.equal(trilhaDe(leadAvaliado({ sinais: [{ tipo: 'rodada_investimento', data: diasAtras(30) }] })), 'novo_capital');
  });

  test('sem sinal nenhum cai na trilha estrutural', () => {
    assert.equal(trilhaDe(leadAvaliado()), 'fit_estrutural');
  });

  test('a mais especifica vence quando ha varios gatilhos', () => {
    const lead = leadAvaliado({
      sinais: [{ tipo: 'visitou_precos', data: diasAtras(1) }, { tipo: 'vaga_aberta', data: diasAtras(5) }],
    });
    assert.equal(trilhaDe(lead), 'pos_precificacao');
  });

  test('o gancho cita o gatilho que de fato aconteceu', () => {
    // A trilha de precificacao cobre dois sinais distintos. Dizer "vi que
    // olharam os precos" para quem pediu uma demo queima a credibilidade na
    // primeira linha.
    const demo = gerar(leadAvaliado({ sinais: [{ tipo: 'demo_solicitada', data: diasAtras(1) }] }));
    assert.match(demo.toques[0].corpo, /demonstracao/);

    const precos = gerar(leadAvaliado({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(1) }] }));
    assert.match(precos.toques[0].corpo, /planos/);
  });

  test('toda trilha declara um angulo explicativo', () => {
    for (const trilha of TRILHAS) {
      assert.ok(trilha.angulo.length > 20, `trilha ${trilha.id} sem angulo`);
      assert.ok(trilha.tom.length > 0);
    }
  });
});

describe('estrutura da cadencia', () => {
  test('tier melhor recebe mais toques', () => {
    const quente = gerar(leadAvaliado({ sinais: [{ tipo: 'demo_solicitada', data: diasAtras(0) }, { tipo: 'respondeu_email', data: diasAtras(1) }] }));
    const frio = gerar(leadAvaliado({ setor: 'agro', funcionarios: 4, tecnologias: [], maturidadeDigital: 1, contato: { nome: 'X', cargo: 'analista' } }));
    assert.ok(quente.toques.length > frio.toques.length);
  });

  test('os toques sao numerados em ordem e com dias crescentes', () => {
    const { toques } = gerar(leadAvaliado({ sinais: [{ tipo: 'demo_solicitada', data: diasAtras(0) }] }));
    toques.forEach((toque, indice) => assert.equal(toque.ordem, indice + 1));
    for (let i = 1; i < toques.length; i += 1) {
      assert.ok(toques[i].dia > toques[i - 1].dia, 'os toques deveriam se espacar no tempo');
    }
  });

  test('as datas previstas batem com o deslocamento em dias', () => {
    for (const toque of gerar(leadAvaliado()).toques) {
      const esperada = new Date(HOJE.getTime() + toque.dia * 86_400_000).toISOString().slice(0, 10);
      assert.equal(toque.dataPrevista, esperada);
    }
  });

  test('todo e-mail tem assunto e todo toque tem corpo', () => {
    for (const toque of gerar(leadAvaliado({ sinais: [{ tipo: 'visitou_precos', data: diasAtras(1) }] })).toques) {
      if (toque.canal === 'email') assert.ok(toque.assunto?.length > 0, `toque ${toque.ordem} sem assunto`);
      assert.ok(toque.corpo.length > 30, `toque ${toque.ordem} com corpo curto demais`);
    }
  });

  test('o esforco estimado e coerente com a quantidade de toques', () => {
    const cadencia = gerar(leadAvaliado({ sinais: [{ tipo: 'demo_solicitada', data: diasAtras(0) }] }));
    assert.ok(cadencia.esforcoTotalMin >= cadencia.toques.length * 3);
  });

  test('lead sem avaliacao falha com erro claro', () => {
    assert.throws(() => gerarCadencia({ empresa: 'X' }, {}), TypeError);
  });
});

describe('personalizacao do texto', () => {
  test('o nome da empresa e o primeiro nome do contato aparecem', () => {
    const cadencia = gerar(leadAvaliado());
    const tudo = cadencia.toques.map((t) => `${t.assunto ?? ''} ${t.corpo}`).join('\n');
    assert.match(tudo, /Acme Solucoes/);
    assert.match(tudo, /\bAna\b/);
    assert.ok(!tudo.includes('Ana Silva'), 'a abordagem deveria usar so o primeiro nome');
  });

  test('a assinatura usa o remetente informado', () => {
    const cadencia = gerar(leadAvaliado(), { remetente: 'Luis Guilherme', empresaRemetente: 'Minha Empresa' });
    const email = cadencia.toques.find((t) => t.canal === 'email');
    assert.match(email.corpo, /Luis Guilherme/);
    assert.match(email.corpo, /Minha Empresa/);
  });

  test('nenhum placeholder vaza para o texto final, em nenhum lead da carteira', () => {
    // Varredura ampla: com carteira sintetica grande, qualquer combinacao de
    // trilha e tier que deixe um {{campo}} solto aparece aqui.
    const carteira = priorizar(gerarCarteira({ quantidade: 250, semente: 'cadencia', referencia: HOJE }), ICP, { referencia: HOJE });
    for (const lead of carteira) {
      const cadencia = gerar(lead);
      for (const toque of cadencia.toques) {
        const texto = `${toque.assunto ?? ''}\n${toque.corpo}`;
        assert.doesNotMatch(texto, /\{\{\w+\}\}/, `placeholder vazado em ${lead.empresa} (toque ${toque.ordem})`);
        assert.doesNotMatch(texto, /undefined|null|NaN/, `valor invalido no texto de ${lead.empresa}`);
      }
    }
  });

  test('o roteiro de ligacao traz uma pergunta de diagnostico', () => {
    const cadencia = gerar(leadAvaliado({ sinais: [{ tipo: 'demo_solicitada', data: diasAtras(0) }, { tipo: 'respondeu_email', data: diasAtras(0) }] }));
    const ligacao = cadencia.toques.find((t) => t.canal === 'telefone');
    assert.ok(ligacao, 'tier alto deveria incluir ligacao');
    assert.match(ligacao.corpo, /\?/);
  });
});
