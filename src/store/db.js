/**
 * Persistencia em SQLite usando o modulo nativo do Node (`node:sqlite`).
 *
 * A escolha e deliberada: zero dependencia externa, o banco e um arquivo unico
 * que da para versionar ou apagar, e o projeto roda no primeiro clone sem
 * `npm install`. Leads ficam em colunas indexaveis; o que e variavel (sinais,
 * stack) fica em JSON, porque nao ha consulta relacional sobre isso.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id                TEXT PRIMARY KEY,
  empresa           TEXT NOT NULL,
  dominio           TEXT,
  setor             TEXT NOT NULL,
  funcionarios      INTEGER NOT NULL,
  receita_anual     INTEGER NOT NULL,
  regiao            TEXT NOT NULL,
  cidade            TEXT,
  maturidade        INTEGER NOT NULL DEFAULT 1,
  tecnologias       TEXT NOT NULL DEFAULT '[]',
  contato           TEXT NOT NULL DEFAULT '{}',
  sinais            TEXT NOT NULL DEFAULT '[]',
  estagio           TEXT NOT NULL DEFAULT 'novo',
  origem            TEXT,
  ultimo_contato_em TEXT,
  criado_em         TEXT NOT NULL,
  atualizado_em     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_setor   ON leads(setor);
CREATE INDEX IF NOT EXISTS idx_leads_estagio ON leads(estagio);
CREATE INDEX IF NOT EXISTS idx_leads_dominio ON leads(dominio);

CREATE TABLE IF NOT EXISTS icp (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  definicao  TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id   TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  detalhe   TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eventos_lead ON eventos(lead_id);
`;

/** Abre (ou cria) o banco com as configuracoes de integridade ligadas. */
export function abrirBanco(caminho = 'data/prospecto.db') {
  const destino = caminho === ':memory:' ? caminho : resolve(caminho);
  if (destino !== ':memory:') mkdirSync(dirname(destino), { recursive: true });

  const db = new DatabaseSync(destino);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Converte um lead do dominio para a linha do banco. */
export function paraLinha(lead, agora = new Date().toISOString()) {
  return {
    id: lead.id,
    empresa: lead.empresa,
    dominio: lead.dominio ?? null,
    setor: lead.setor,
    funcionarios: Math.round(lead.funcionarios ?? 0),
    receita_anual: Math.round(lead.receitaAnual ?? 0),
    regiao: lead.regiao,
    cidade: lead.cidade ?? null,
    maturidade: Math.round(lead.maturidadeDigital ?? 1),
    tecnologias: JSON.stringify(lead.tecnologias ?? []),
    contato: JSON.stringify(lead.contato ?? {}),
    sinais: JSON.stringify(lead.sinais ?? []),
    estagio: lead.estagio ?? 'novo',
    origem: lead.origem ?? null,
    ultimo_contato_em: lead.ultimoContatoEm ?? null,
    criado_em: lead.criadoEm ?? agora,
    atualizado_em: agora,
  };
}

/** Converte a linha do banco de volta para o formato do dominio. */
export function paraLead(linha) {
  return {
    id: linha.id,
    empresa: linha.empresa,
    dominio: linha.dominio,
    setor: linha.setor,
    funcionarios: linha.funcionarios,
    receitaAnual: linha.receita_anual,
    regiao: linha.regiao,
    cidade: linha.cidade,
    maturidadeDigital: linha.maturidade,
    tecnologias: JSON.parse(linha.tecnologias),
    contato: JSON.parse(linha.contato),
    sinais: JSON.parse(linha.sinais),
    estagio: linha.estagio,
    origem: linha.origem,
    ultimoContatoEm: linha.ultimo_contato_em,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}
