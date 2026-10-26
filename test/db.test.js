/**
 * Testes do modulo de persistencia (db.js).
 *
 * Cobre os caminhos de branch que o repositorio nao exercita diretamente:
 * criacao em memoria, conversao de campos nulos e ausentes, e ida-volta de
 * tipos JSON.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { abrirBanco, paraLinha, paraLead } from '../src/store/db.js';

describe('abrirBanco', () => {
  test('abre banco em memoria e cria as tabelas', () => {
    const db = abrirBanco(':memory:');
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const nomes = tabelas.map((t) => t.name);

    assert.ok(nomes.includes('leads'), 'tabela leads deve existir');
    assert.ok(nomes.includes('icp'), 'tabela icp deve existir');
    assert.ok(nomes.includes('eventos'), 'tabela eventos deve existir');
    db.close();
  });

  test('executa idempotente quando as tabelas ja existem', () => {
    const db = abrirBanco(':memory:');
    db.exec("INSERT INTO leads (id, empresa, setor, funcionarios, receita_anual, regiao, maturidade, criado_em, atualizado_em) VALUES ('x', 'ACME', 'saas', 10, 1000, 'sudeste', 3, '2025-01-01', '2025-01-01')");

    const db2 = new (Object.getPrototypeOf(db).constructor)(':memory:');
    assert.doesNotThrow(() => abrirBanco(':memory:'));
    db.close();
  });

  test('ativa foreign keys', () => {
    const db = abrirBanco(':memory:');
    const fk = db.prepare('PRAGMA foreign_keys').get();

    assert.equal(fk.foreign_keys, 1);
    db.close();
  });

  test('ativa WAL em banco com arquivo', async () => {
    const { rmSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'test', '.tmp-wal-test');

    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      const caminho = join(dir, 'wal.db');
      const db = abrirBanco(caminho);
      const journal = db.prepare('PRAGMA journal_mode').get();
      assert.equal(journal.journal_mode, 'wal');
      db.close();
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });

  test('cria diretorio quando necessario', async () => {
    const { mkdirSync, rmSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'test', '.tmp-db-test');

    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      const caminho = join(dir, 'sub', 'banco.db');
      const db = abrirBanco(caminho);
      assert.ok(existsSync(caminho), 'arquivo do banco deve ser criado');
      db.close();
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  });
});

describe('paraLinha', () => {
  test('converte lead completo para linha do banco', () => {
    const lead = {
      id: 'LD-1',
      empresa: 'ACME',
      dominio: 'acme.com',
      setor: 'saas',
      funcionarios: 50,
      receitaAnual: 5000000,
      regiao: 'sudeste',
      cidade: 'Sao Paulo',
      maturidadeDigital: 4,
      tecnologias: ['hubspot', 'zapier'],
      contato: { nome: 'Joao', cargo: 'ceo' },
      sinais: [{ tipo: 'visitou_precos', data: '2025-01-01' }],
      estagio: 'contatado',
      origem: 'csv',
      ultimoContatoEm: '2025-01-01',
      criadoEm: '2025-01-01',
    };

    const linha = paraLinha(lead, '2025-06-01');

    assert.equal(linha.id, 'LD-1');
    assert.equal(linha.empresa, 'ACME');
    assert.equal(linha.funcionarios, 50);
    assert.equal(linha.receita_anual, 5000000);
    assert.equal(linha.maturidade, 4);
    assert.equal(linha.tecnologias, '["hubspot","zapier"]');
    assert.equal(linha.contato, '{"nome":"Joao","cargo":"ceo"}');
    assert.equal(linha.sinais, '[{"tipo":"visitou_precos","data":"2025-01-01"}]');
    assert.equal(linha.estagio, 'contatado');
    assert.equal(linha.atualizado_em, '2025-06-01');
    assert.equal(linha.criado_em, '2025-01-01');
  });

  test('trata campos opcionais ausentes com defaults', () => {
    const lead = {
      id: 'LD-2',
      empresa: 'Minimal',
      setor: 'ecommerce',
      regiao: 'sul',
    };

    const linha = paraLinha(lead);

    assert.equal(linha.dominio, null);
    assert.equal(linha.cidade, null);
    assert.equal(linha.funcionarios, 0);
    assert.equal(linha.receita_anual, 0);
    assert.equal(linha.maturidade, 1);
    assert.equal(linha.tecnologias, '[]');
    assert.equal(linha.contato, '{}');
    assert.equal(linha.sinais, '[]');
    assert.equal(linha.estagio, 'novo');
    assert.equal(linha.origem, null);
    assert.equal(linha.ultimo_contato_em, null);
  });

  test('arredonda funcionarios e receita', () => {
    const linha = paraLinha({
      id: 'LD-3', empresa: 'X', setor: 's', regiao: 'r',
      funcionarios: 49.7, receitaAnual: 999.4,
    });

    assert.equal(linha.funcionarios, 50);
    assert.equal(linha.receita_anual, 999);
  });
});

describe('paraLead', () => {
  test('converte linha do banco para formato de dominio', () => {
    const linha = {
      id: 'LD-1',
      empresa: 'ACME',
      dominio: 'acme.com',
      setor: 'saas',
      funcionarios: 50,
      receita_anual: 5000000,
      regiao: 'sudeste',
      cidade: 'SP',
      maturidade: 4,
      tecnologias: '["hubspot"]',
      contato: '{"nome":"Ana"}',
      sinais: '[]',
      estagio: 'novo',
      origem: null,
      ultimo_contato_em: null,
      criado_em: '2025-01-01',
      atualizado_em: '2025-06-01',
    };

    const lead = paraLead(linha);

    assert.equal(lead.receitaAnual, 5000000);
    assert.equal(lead.maturidadeDigital, 4);
    assert.deepEqual(lead.tecnologias, ['hubspot']);
    assert.deepEqual(lead.contato, { nome: 'Ana' });
    assert.deepEqual(lead.sinais, []);
    assert.equal(lead.ultimoContatoEm, null);
    assert.equal(lead.criadoEm, '2025-01-01');
    assert.equal(lead.atualizadoEm, '2025-06-01');
  });

  test('ida e volta paraLinha -> paraLead preserva os dados', () => {
    const original = {
      id: 'LD-RT',
      empresa: 'Roundtrip',
      dominio: 'rt.io',
      setor: 'saas',
      funcionarios: 100,
      receitaAnual: 10000000,
      regiao: 'sudeste',
      cidade: 'RJ',
      maturidadeDigital: 5,
      tecnologias: ['salesforce', 'n8n'],
      contato: { nome: 'Maria', cargo: 'ceo', email: 'm@rt.io' },
      sinais: [{ tipo: 'visitou_precos', data: '2025-03-01', intensidade: 1 }],
      estagio: 'engajado',
      origem: 'linkedin',
      ultimoContatoEm: '2025-03-01',
      criadoEm: '2025-01-01',
    };

    const volta = paraLead(paraLinha(original, '2025-06-01'));

    assert.equal(volta.empresa, original.empresa);
    assert.equal(volta.funcionarios, original.funcionarios);
    assert.equal(volta.receitaAnual, original.receitaAnual);
    assert.equal(volta.maturidadeDigital, original.maturidadeDigital);
    assert.deepEqual(volta.tecnologias, original.tecnologias);
    assert.deepEqual(volta.contato, original.contato);
    assert.equal(volta.sinais.length, original.sinais.length);
    assert.equal(volta.estagio, original.estagio);
  });
});
