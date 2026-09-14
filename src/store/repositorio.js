/**
 * Repositorio: a unica porta de entrada ao banco.
 *
 * Nenhum outro modulo escreve SQL. Isso mantem o dominio testavel em memoria e
 * deixa a troca de banco como um problema de um arquivo so.
 */

import { abrirBanco, paraLinha, paraLead } from './db.js';
import { ICP_PADRAO, normalizarIcp } from '../core/icp.js';

const CAMPOS = ['id', 'empresa', 'dominio', 'setor', 'funcionarios', 'receita_anual', 'regiao', 'cidade',
  'maturidade', 'tecnologias', 'contato', 'sinais', 'estagio', 'origem', 'ultimo_contato_em',
  'criado_em', 'atualizado_em'];

export class Repositorio {
  #db;

  constructor(caminho = 'data/prospecto.db') {
    this.#db = abrirBanco(caminho);
  }

  fechar() {
    this.#db.close();
  }

  /** Insere ou atualiza leads em lote, dentro de uma transacao unica. */
  salvarLeads(leads) {
    const colunas = CAMPOS.join(', ');
    const marcadores = CAMPOS.map((c) => `$${c}`).join(', ');
    const atualizacoes = CAMPOS.filter((c) => c !== 'id' && c !== 'criado_em')
      .map((c) => `${c} = excluded.${c}`).join(', ');

    const stmt = this.#db.prepare(
      `INSERT INTO leads (${colunas}) VALUES (${marcadores})
       ON CONFLICT(id) DO UPDATE SET ${atualizacoes}`);

    const agora = new Date().toISOString();
    this.#db.exec('BEGIN');
    try {
      for (const lead of leads) stmt.run(paraLinha(lead, agora));
      this.#db.exec('COMMIT');
    } catch (erro) {
      this.#db.exec('ROLLBACK');
      throw erro;
    }
    return leads.length;
  }

  /**
   * Lista leads com filtros opcionais.
   * @param {object} filtros { setor, estagio, regiao, busca, limite, offset }
   */
  listarLeads(filtros = {}) {
    const condicoes = [];
    const parametros = {};

    if (filtros.setor) { condicoes.push('setor = $setor'); parametros.setor = filtros.setor; }
    if (filtros.estagio) { condicoes.push('estagio = $estagio'); parametros.estagio = filtros.estagio; }
    if (filtros.regiao) { condicoes.push('regiao = $regiao'); parametros.regiao = filtros.regiao; }
    if (filtros.busca) {
      condicoes.push('(LOWER(empresa) LIKE $busca OR LOWER(COALESCE(dominio, %s)) LIKE $busca)'.replace('%s', "''"));
      parametros.busca = `%${String(filtros.busca).toLowerCase()}%`;
    }

    const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
    const limite = Number.isFinite(filtros.limite) ? Math.min(filtros.limite, 5000) : 5000;
    const offset = Number.isFinite(filtros.offset) ? filtros.offset : 0;

    const linhas = this.#db
      .prepare(`SELECT * FROM leads ${onde} ORDER BY empresa LIMIT ${limite} OFFSET ${offset}`)
      .all(parametros);
    return linhas.map(paraLead);
  }

  buscarLead(id) {
    const linha = this.#db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    return linha ? paraLead(linha) : null;
  }

  contarLeads() {
    return this.#db.prepare('SELECT COUNT(*) AS total FROM leads').get().total;
  }

  removerTodos() {
    this.#db.exec('DELETE FROM eventos; DELETE FROM leads;');
  }

  /** Move o lead de estagio e registra o evento na linha do tempo. */
  atualizarEstagio(id, estagio) {
    const agora = new Date().toISOString();
    const resultado = this.#db
      .prepare('UPDATE leads SET estagio = ?, atualizado_em = ? WHERE id = ?')
      .run(estagio, agora, id);
    if (resultado.changes === 0) return null;
    this.registrarEvento(id, 'mudanca_estagio', { estagio });
    return this.buscarLead(id);
  }

  /** Acrescenta um sinal de intencao e atualiza a data do ultimo contato quando faz sentido. */
  registrarSinal(id, tipo, data = new Date().toISOString(), intensidade = 1) {
    const lead = this.buscarLead(id);
    if (!lead) return null;

    const sinais = [{ tipo, data, intensidade }, ...lead.sinais]
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    const tocouOContato = ['respondeu_email', 'reuniao_realizada', 'demo_solicitada'].includes(tipo);
    const agora = new Date().toISOString();

    this.#db.prepare('UPDATE leads SET sinais = ?, ultimo_contato_em = ?, atualizado_em = ? WHERE id = ?')
      .run(JSON.stringify(sinais), tocouOContato ? data : lead.ultimoContatoEm, agora, id);
    this.registrarEvento(id, 'sinal', { tipo, data });
    return this.buscarLead(id);
  }

  registrarEvento(leadId, tipo, detalhe = {}) {
    this.#db.prepare('INSERT INTO eventos (lead_id, tipo, detalhe, criado_em) VALUES (?, ?, ?, ?)')
      .run(leadId, tipo, JSON.stringify(detalhe), new Date().toISOString());
  }

  listarEventos(leadId, limite = 50) {
    return this.#db
      .prepare('SELECT * FROM eventos WHERE lead_id = ? ORDER BY id DESC LIMIT ?')
      .all(leadId, limite)
      .map((linha) => ({ ...linha, detalhe: JSON.parse(linha.detalhe ?? '{}') }));
  }

  /** ICP persistido; cai no padrao quando o banco esta vazio. */
  obterIcp() {
    const linha = this.#db.prepare('SELECT definicao FROM icp WHERE id = 1').get();
    return linha ? normalizarIcp(JSON.parse(linha.definicao)) : normalizarIcp(ICP_PADRAO);
  }

  salvarIcp(definicao) {
    const icp = normalizarIcp(definicao);
    this.#db.prepare(`INSERT INTO icp (id, definicao, atualizado_em) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET definicao = excluded.definicao, atualizado_em = excluded.atualizado_em`)
      .run(JSON.stringify(icp), new Date().toISOString());
    return icp;
  }
}
