/**
 * Camada HTTP da API.
 *
 * A regra de negocio inteira vive em `src/core`; aqui so ha traducao de HTTP
 * para chamada de dominio e de volta. Isso mantem o motor de scoring utilizavel
 * como biblioteca, sem servidor nenhum.
 */

import { Roteador, ErroHttp } from './roteador.js';
import { priorizar, montarFilaDoDia, resumirCarteira, ESTAGIOS } from '../core/priorizacao.js';
import { projetarPipeline } from '../core/previsao.js';
import { gerarCadencia } from '../core/cadencia.js';
import { avaliarLead } from '../core/scoring.js';
import { ErroDeValidacao } from '../core/icp.js';
import { SETORES, REGIOES, SINAIS, CARGOS, SINAL_POR_ID } from '../data/taxonomy.js';
import { escreverCsv } from '../lib/csv.js';

const ESTAGIOS_VALIDOS = new Set(ESTAGIOS);

/**
 * Cache da priorizacao.
 *
 * Priorizar 5 mil leads e barato, mas o painel chama varias rotas seguidas e
 * recalcular tudo em cada uma tornaria a navegacao perceptivelmente lenta. O
 * cache e invalidado em qualquer escrita, entao nunca serve dado velho.
 */
function criarCache(repositorio) {
  let memoria = null;
  return {
    obter(referencia) {
      const icp = repositorio.obterIcp();
      const chave = `${repositorio.contarLeads()}:${JSON.stringify(icp)}:${referencia.toISOString().slice(0, 13)}`;
      if (memoria && memoria.chave === chave) return memoria.valor;
      const valor = priorizar(repositorio.listarLeads(), icp, { referencia });
      memoria = { chave, valor };
      return valor;
    },
    invalidar() { memoria = null; },
  };
}

export function montarApi(repositorio, opcoes = {}) {
  const roteador = new Roteador();
  const cache = criarCache(repositorio);
  const agora = () => opcoes.referencia ?? new Date();

  const priorizados = () => cache.obter(agora());
  const acharLead = (id) => {
    const lead = priorizados().find((l) => l.id === id) ?? repositorio.buscarLead(id);
    if (!lead) throw new ErroHttp(404, `Lead "${id}" nao encontrado`);
    return lead;
  };

  roteador.get('/api/saude', () => ({ status: 'ok', leads: repositorio.contarLeads(), versao: opcoes.versao ?? '1.0.0' }));

  roteador.get('/api/meta', () => ({
    setores: SETORES, regioes: REGIOES, sinais: SINAIS, cargos: CARGOS, estagios: ESTAGIOS,
  }));

  roteador.get('/api/icp', () => repositorio.obterIcp());

  roteador.put('/api/icp', (ctx) => {
    try {
      const icp = repositorio.salvarIcp(ctx.corpo ?? {});
      cache.invalidar();
      return icp;
    } catch (erro) {
      if (erro instanceof ErroDeValidacao) throw new ErroHttp(422, erro.message, erro.problemas);
      throw erro;
    }
  });

  roteador.get('/api/leads', (ctx) => {
    const { tier, estagio, setor, regiao, busca, acao } = ctx.query;
    const pagina = Math.max(1, Number(ctx.query.pagina ?? 1));
    const porPagina = Math.min(200, Math.max(1, Number(ctx.query.porPagina ?? 50)));

    let lista = priorizados();
    if (tier) lista = lista.filter((l) => tier.split(',').includes(l.tier));
    if (estagio) lista = lista.filter((l) => l.estagio === estagio);
    if (setor) lista = lista.filter((l) => l.setor === setor);
    if (regiao) lista = lista.filter((l) => l.regiao === regiao);
    if (acao) lista = lista.filter((l) => l.proximaAcao.acao === acao);
    if (busca) {
      const termo = busca.toLowerCase();
      lista = lista.filter((l) => l.empresa.toLowerCase().includes(termo)
        || (l.dominio ?? '').toLowerCase().includes(termo)
        || (l.contato?.nome ?? '').toLowerCase().includes(termo));
    }

    const inicio = (pagina - 1) * porPagina;
    return {
      total: lista.length,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(lista.length / porPagina)),
      itens: lista.slice(inicio, inicio + porPagina).map(resumirLead),
    };
  });

  roteador.get('/api/leads/:id', (ctx) => acharLead(ctx.parametros.id));

  roteador.patch('/api/leads/:id/estagio', (ctx) => {
    const estagio = ctx.corpo?.estagio;
    if (!ESTAGIOS_VALIDOS.has(estagio)) {
      throw new ErroHttp(422, `Estagio invalido: "${estagio}"`, { validos: [...ESTAGIOS_VALIDOS] });
    }
    const atualizado = repositorio.atualizarEstagio(ctx.parametros.id, estagio);
    if (!atualizado) throw new ErroHttp(404, `Lead "${ctx.parametros.id}" nao encontrado`);
    cache.invalidar();
    return atualizado;
  });

  roteador.post('/api/leads/:id/sinais', (ctx) => {
    const tipo = ctx.corpo?.tipo;
    if (!SINAL_POR_ID.has(tipo)) {
      throw new ErroHttp(422, `Sinal desconhecido: "${tipo}"`, { validos: [...SINAL_POR_ID.keys()] });
    }
    const atualizado = repositorio.registrarSinal(
      ctx.parametros.id, tipo, ctx.corpo?.data ?? new Date().toISOString(), ctx.corpo?.intensidade ?? 1);
    if (!atualizado) throw new ErroHttp(404, `Lead "${ctx.parametros.id}" nao encontrado`);
    cache.invalidar();
    return { ...atualizado, avaliacao: avaliarLead(atualizado, repositorio.obterIcp(), agora()) };
  });

  roteador.get('/api/leads/:id/eventos', (ctx) => repositorio.listarEventos(ctx.parametros.id));

  roteador.post('/api/leads/:id/cadencia', (ctx) => gerarCadencia(acharLead(ctx.parametros.id), {
    referencia: agora(),
    remetente: ctx.corpo?.remetente,
    empresaRemetente: ctx.corpo?.empresaRemetente,
    casoDeSucesso: ctx.corpo?.casoDeSucesso,
  }));

  roteador.get('/api/fila', (ctx) => {
    const capacidade = Math.min(200, Math.max(1, Number(ctx.query.capacidade ?? 25)));
    return montarFilaDoDia(priorizados(), { capacidade }).map(resumirLead);
  });

  roteador.get('/api/resumo', () => resumirCarteira(priorizados()));

  roteador.get('/api/previsao', (ctx) => projetarPipeline(priorizados(), {
    referencia: agora(),
    horizonteDias: Number(ctx.query.horizonte ?? 90),
    meta: Number(ctx.query.meta ?? 0),
  }));

  roteador.get('/api/exportar.csv', (ctx) => {
    const tier = ctx.query.tier;
    const lista = tier ? priorizados().filter((l) => tier.split(',').includes(l.tier)) : priorizados();
    const csv = escreverCsv(lista.map((lead) => ({
      id: lead.id,
      empresa: lead.empresa,
      dominio: lead.dominio,
      setor: lead.setor,
      funcionarios: lead.funcionarios,
      regiao: lead.regiao,
      contato: lead.contato?.nome ?? '',
      cargo: lead.contato?.cargo ?? '',
      email: lead.contato?.email ?? '',
      telefone: lead.contato?.telefone ?? '',
      score: lead.score,
      tier: lead.tier,
      urgencia: lead.urgencia,
      estagio: lead.estagio,
      valor_potencial: lead.valorPotencial,
      proxima_acao: lead.proximaAcao.acao,
      prazo_dias: lead.proximaAcao.prazoDias,
      justificativa: lead.proximaAcao.justificativa,
    })));
    return { __resposta: { tipo: 'text/csv; charset=utf-8', corpo: csv, arquivo: 'prospecto-carteira.csv' } };
  });

  return { roteador, invalidarCache: () => cache.invalidar() };
}

/** Versao enxuta do lead para listagens: o painel nao precisa do breakdown inteiro. */
function resumirLead(lead) {
  return {
    id: lead.id,
    empresa: lead.empresa,
    dominio: lead.dominio,
    setor: lead.setor,
    regiao: lead.regiao,
    cidade: lead.cidade,
    funcionarios: lead.funcionarios,
    receitaAnual: lead.receitaAnual,
    contato: lead.contato,
    estagio: lead.estagio,
    score: lead.score,
    tier: lead.tier,
    urgencia: lead.urgencia,
    posicao: lead.posicao,
    valorPotencial: lead.valorPotencial,
    scorePrioridade: lead.scorePrioridade,
    proximaAcao: lead.proximaAcao,
    motivos: lead.avaliacao.motivos,
    dimensoes: {
      fit: lead.avaliacao.dimensoes.fit.score,
      intencao: lead.avaliacao.dimensoes.intencao.score,
      acessibilidade: lead.avaliacao.dimensoes.acessibilidade.score,
    },
    sinaisRecentes: lead.avaliacao.dimensoes.intencao.sinais.slice(0, 3),
  };
}
