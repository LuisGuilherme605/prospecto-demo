/**
 * Testes das bibliotecas de apoio: CSV, deduplicacao e gerador aleatorio.
 * Sao os pontos onde dado do mundo real entra no sistema -- e onde ele costuma
 * estar torto.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { lerCsv, escreverCsv, detectarDelimitador } from '../src/lib/csv.js';
import { deduplicar, normalizarEmpresa, normalizarDominio, distanciaEdicao, confiancaDeDuplicata } from '../src/lib/dedup.js';
import { createRng, seedFrom } from '../src/lib/rng.js';
import { gerarCarteira } from '../src/data/gerador.js';

describe('lerCsv', () => {
  test('le um CSV simples', () => {
    assert.deepEqual(lerCsv('a,b\n1,2\n'), [{ a: '1', b: '2' }]);
  });

  test('respeita virgula dentro de campo entre aspas', () => {
    assert.deepEqual(lerCsv('empresa,cidade\n"Acme, Ltda",Sao Paulo\n'),
      [{ empresa: 'Acme, Ltda', cidade: 'Sao Paulo' }]);
  });

  test('entende aspas escapadas', () => {
    assert.deepEqual(lerCsv('a\n"diz ""oi"""\n'), [{ a: 'diz "oi"' }]);
  });

  test('aceita quebra de linha dentro do campo', () => {
    assert.deepEqual(lerCsv('a,b\n"linha 1\nlinha 2",x\n'), [{ a: 'linha 1\nlinha 2', b: 'x' }]);
  });

  test('detecta ponto e virgula, o padrao do Excel brasileiro', () => {
    assert.equal(detectarDelimitador('a;b;c\n1;2;3'), ';');
    assert.equal(detectarDelimitador('a,b,c\n1,2,3'), ',');
    assert.deepEqual(lerCsv('a;b\n1;2\n'), [{ a: '1', b: '2' }]);
  });

  test('remove o BOM que o Excel escreve no inicio do arquivo', () => {
    assert.deepEqual(lerCsv('﻿empresa\nAcme\n'), [{ empresa: 'Acme' }]);
  });

  test('aceita CRLF', () => {
    assert.deepEqual(lerCsv('a,b\r\n1,2\r\n'), [{ a: '1', b: '2' }]);
  });

  test('ignora linhas em branco', () => {
    assert.equal(lerCsv('a,b\n1,2\n\n\n3,4\n').length, 2);
  });

  test('CSV vazio ou so com cabecalho devolve lista vazia', () => {
    assert.deepEqual(lerCsv(''), []);
    assert.deepEqual(lerCsv('a,b\n'), []);
  });

  test('completa colunas faltantes com string vazia', () => {
    assert.deepEqual(lerCsv('a,b,c\n1,2\n'), [{ a: '1', b: '2', c: '' }]);
  });
});

describe('escreverCsv', () => {
  test('faz ida e volta sem perder conteudo', () => {
    const original = [
      { empresa: 'Acme, Ltda', obs: 'linha 1\nlinha 2', valor: '100' },
      { empresa: 'Diz "oi"', obs: '', valor: '200' },
    ];
    assert.deepEqual(lerCsv(escreverCsv(original)), original);
  });

  test('lista vazia gera string vazia', () => {
    assert.equal(escreverCsv([]), '');
  });

  test('valores nulos viram campo vazio', () => {
    assert.equal(escreverCsv([{ a: null, b: undefined, c: 0 }]).trim(), 'a,b,c\n,,0');
  });

  test('arrays sao serializados com barra vertical', () => {
    assert.match(escreverCsv([{ stack: ['aws', 'gcp'] }]), /aws\|gcp/);
  });

  test('respeita a ordem de colunas quando informada', () => {
    assert.match(escreverCsv([{ b: 2, a: 1 }], { colunas: ['a', 'b'] }), /^a,b\n1,2/);
  });
});

describe('normalizacao para deduplicacao', () => {
  test('ignora acento, caixa, pontuacao e sufixo societario', () => {
    assert.equal(normalizarEmpresa('Açaí & Cia Ltda'), normalizarEmpresa('ACAI E CIA'.replace(' E ', ' & ')));
    assert.equal(normalizarEmpresa('Acme Ltda'), 'acme');
    assert.equal(normalizarEmpresa('ACME S/A'), 'acme');
  });

  test('normaliza dominio removendo protocolo, www e caminho', () => {
    for (const entrada of ['https://www.acme.com.br/precos?x=1', 'WWW.ACME.COM.BR', 'acme.com.br']) {
      assert.equal(normalizarDominio(entrada), 'acme.com.br');
    }
    assert.equal(normalizarDominio(null), '');
  });
});

describe('distanciaEdicao', () => {
  test('mede as edicoes necessarias', () => {
    assert.equal(distanciaEdicao('acme', 'acme'), 0);
    assert.equal(distanciaEdicao('acme', 'acmee'), 1);
    assert.equal(distanciaEdicao('acme', 'akme'), 1);
  });

  test('corta cedo quando passa do limite', () => {
    assert.ok(distanciaEdicao('acme', 'totalmente diferente', 3) > 3);
  });
});

describe('deduplicar', () => {
  test('junta registros com o mesmo dominio escrito de formas diferentes', () => {
    const resultado = deduplicar([
      { empresa: 'Acme Ltda', dominio: 'acme.com.br' },
      { empresa: 'ACME', dominio: 'https://www.acme.com.br/' },
      { empresa: 'Outra', dominio: 'outra.com.br' },
    ]);
    assert.equal(resultado.unicos.length, 2);
    assert.equal(resultado.removidos, 1);
  });

  test('preserva os sinais de todos os registros mesclados', () => {
    // O sinal de intencao e o dado mais valioso do lead: perder um por causa da
    // deduplicacao seria o pior efeito colateral possivel.
    const resultado = deduplicar([
      { empresa: 'Acme', dominio: 'acme.com', sinais: [{ tipo: 'abriu_email', data: '2026-01-01' }] },
      {
        empresa: 'Acme Ltda',
        dominio: 'acme.com',
        sinais: [{ tipo: 'visitou_precos', data: '2026-02-01' }],
        contato: { nome: 'B', cargo: 'ceo', email: 'b@acme.com', telefone: '1', linkedin: 'x' },
      },
    ]);
    const tipos = resultado.unicos[0].sinais.map((s) => s.tipo).sort();
    assert.deepEqual(tipos, ['abriu_email', 'visitou_precos']);
  });

  test('mantem o registro mais completo como sobrevivente', () => {
    const resultado = deduplicar([
      { empresa: 'Acme', dominio: 'acme.com' },
      { empresa: 'Acme Solucoes', dominio: 'acme.com', setor: 'saas', funcionarios: 50, cidade: 'SP', contato: { nome: 'B', email: 'b@acme.com', telefone: '1' } },
    ]);
    assert.equal(resultado.unicos[0].empresa, 'Acme Solucoes');
    assert.deepEqual(resultado.grupos[0].mesclados, ['Acme']);
  });

  test('de cada tipo de sinal fica apenas o mais recente', () => {
    const resultado = deduplicar([
      { empresa: 'Acme', dominio: 'acme.com', sinais: [{ tipo: 'abriu_email', data: '2026-01-01' }] },
      { empresa: 'Acme', dominio: 'acme.com', sinais: [{ tipo: 'abriu_email', data: '2026-03-01' }] },
    ]);
    assert.equal(resultado.unicos[0].sinais.length, 1);
    assert.match(resultado.unicos[0].sinais[0].data, /2026-03/);
  });

  test('une a stack tecnologica das duas fontes', () => {
    const resultado = deduplicar([
      { empresa: 'Acme', dominio: 'acme.com', tecnologias: ['aws'] },
      { empresa: 'Acme', dominio: 'acme.com', tecnologias: ['gcp', 'aws'] },
    ]);
    assert.deepEqual(resultado.unicos[0].tecnologias.sort(), ['aws', 'gcp']);
  });

  test('empresas diferentes com nomes parecidos nao sao unidas', () => {
    const resultado = deduplicar([
      { empresa: 'Alpha Tech', dominio: 'alphatech.com' },
      { empresa: 'Beta Tech', dominio: 'betatech.com' },
    ]);
    assert.equal(resultado.unicos.length, 2);
  });

  test('dominio do e-mail serve de prova quando nao ha dominio no registro', () => {
    assert.ok(confiancaDeDuplicata(
      { empresa: 'X', contato: { email: 'a@acme.com' } },
      { empresa: 'Y', contato: { email: 'b@acme.com' } }) >= 0.9);
  });

  test('lista vazia nao quebra', () => {
    assert.deepEqual(deduplicar([]), { unicos: [], removidos: 0, grupos: [] });
  });
});

describe('createRng', () => {
  test('a mesma semente produz a mesma sequencia', () => {
    const a = createRng('semente');
    const b = createRng('semente');
    for (let i = 0; i < 100; i += 1) assert.equal(a.next(), b.next());
  });

  test('sementes diferentes divergem', () => {
    assert.notEqual(createRng('a').next(), createRng('b').next());
  });

  test('next fica sempre em [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 5000; i += 1) {
      const valor = rng.next();
      assert.ok(valor >= 0 && valor < 1, `valor fora do intervalo: ${valor}`);
    }
  });

  test('int respeita os limites inclusive', () => {
    const rng = createRng('int');
    const vistos = new Set();
    for (let i = 0; i < 2000; i += 1) {
      const valor = rng.int(1, 6);
      assert.ok(valor >= 1 && valor <= 6);
      vistos.add(valor);
    }
    assert.equal(vistos.size, 6, 'todas as faces deveriam aparecer');
  });

  test('weighted segue os pesos', () => {
    const rng = createRng('pesos');
    let raros = 0;
    for (let i = 0; i < 10_000; i += 1) {
      if (rng.weighted([{ value: 'raro', weight: 1 }, { value: 'comum', weight: 9 }]) === 'raro') raros += 1;
    }
    assert.ok(raros > 700 && raros < 1300, `esperava ~1000 ocorrencias raras, veio ${raros}`);
  });

  test('sample nao repete itens', () => {
    const itens = Array.from({ length: 20 }, (_, i) => i);
    const amostra = createRng('amostra').sample(itens, 8);
    assert.equal(new Set(amostra).size, 8);
  });

  test('sample nunca devolve mais do que existe', () => {
    assert.equal(createRng('x').sample([1, 2, 3], 10).length, 3);
  });

  test('shuffle preserva o conjunto e nao altera o original', () => {
    const original = [1, 2, 3, 4, 5];
    const copia = [...original];
    const embaralhado = createRng('s').shuffle(original);
    assert.deepEqual(original, copia);
    assert.deepEqual([...embaralhado].sort(), copia);
  });

  test('normal respeita os limites de truncamento', () => {
    const rng = createRng('normal');
    for (let i = 0; i < 2000; i += 1) {
      const valor = rng.normal(100, 50, 10, 200);
      assert.ok(valor >= 10 && valor <= 200, `valor fora dos limites: ${valor}`);
    }
  });

  test('pick com lista vazia falha de forma explicita', () => {
    assert.throws(() => createRng('x').pick([]), RangeError);
  });

  test('seedFrom e estavel para a mesma string', () => {
    assert.equal(seedFrom('prospecto'), seedFrom('prospecto'));
    assert.notEqual(seedFrom('a'), seedFrom('b'));
  });
});

describe('gerarCarteira', () => {
  const REF = new Date('2026-09-14T00:00:00.000Z');

  test('a mesma semente gera exatamente a mesma carteira', () => {
    const a = gerarCarteira({ quantidade: 60, semente: 'x', referencia: REF });
    const b = gerarCarteira({ quantidade: 60, semente: 'x', referencia: REF });
    assert.deepEqual(a, b);
  });

  test('sementes diferentes geram carteiras diferentes', () => {
    const a = gerarCarteira({ quantidade: 60, semente: 'a', referencia: REF });
    const b = gerarCarteira({ quantidade: 60, semente: 'b', referencia: REF });
    assert.notDeepEqual(a.map((l) => l.empresa), b.map((l) => l.empresa));
  });

  test('gera a quantidade pedida com ids unicos', () => {
    const leads = gerarCarteira({ quantidade: 250, semente: 'ids', referencia: REF });
    assert.equal(leads.length, 250);
    assert.equal(new Set(leads.map((l) => l.id)).size, 250);
  });

  test('todo lead sai com os campos obrigatorios preenchidos', () => {
    for (const lead of gerarCarteira({ quantidade: 120, semente: 'campos', referencia: REF })) {
      for (const campo of ['id', 'empresa', 'dominio', 'setor', 'funcionarios', 'receitaAnual', 'regiao', 'estagio']) {
        assert.ok(lead[campo] !== undefined && lead[campo] !== null, `${lead.id} sem ${campo}`);
      }
      assert.ok(lead.funcionarios > 0);
      assert.ok(lead.maturidadeDigital >= 1 && lead.maturidadeDigital <= 5);
    }
  });

  test('nenhum sinal e datado no futuro', () => {
    for (const lead of gerarCarteira({ quantidade: 150, semente: 'datas', referencia: REF })) {
      for (const sinal of lead.sinais) {
        assert.ok(new Date(sinal.data) <= REF, `sinal no futuro em ${lead.id}`);
      }
    }
  });

  test('a carteira nao e uniforme: ha bons, medianos e ruins', () => {
    // Uma carteira uniforme faria o motor de scoring parecer bom sem provar nada.
    const leads = gerarCarteira({ quantidade: 400, semente: 'distribuicao', referencia: REF });
    const arquetipos = new Set(leads.map((l) => l.arquetipo));
    assert.ok(arquetipos.size >= 4, `esperava variedade de arquetipos, veio ${arquetipos.size}`);
  });

  test('parte dos contatos nao tem todos os canais', () => {
    const leads = gerarCarteira({ quantidade: 200, semente: 'canais', referencia: REF });
    const semTelefone = leads.filter((l) => !l.contato.telefone).length;
    assert.ok(semTelefone > 0 && semTelefone < leads.length, 'a cobertura de canais deveria variar');
  });
});
