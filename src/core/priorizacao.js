/**
 * Priorizacao de carteira.
 *
 * Um ranking por score resolve "quem e bom". O que o time comercial precisa e
 * "o que eu faco nas proximas 4 horas". Este modulo transforma score em fila de
 * trabalho: decide a proxima acao de cada lead e respeita a capacidade real do
 * time em vez de entregar uma lista infinita.
 */

import { avaliarLead } from './scoring.js';
import { SETOR_POR_ID, PORTE_POR_ID, porteDeFuncionarios } from '../data/taxonomy.js';

/** Estagios do funil, na ordem. */
export const ESTAGIOS = ['novo', 'contatado', 'engajado', 'reuniao', 'oportunidade', 'ganho', 'perdido'];

const ESTAGIOS_ENCERRADOS = new Set(['ganho', 'perdido']);
const DIA_MS = 86_400_000;

/**
 * Valor potencial anual do lead (BRL), por setor e porte.
 * Serve tanto para o forecast quanto para o desempate do ranking.
 */
export function valorPotencial(lead) {
  const setor = SETOR_POR_ID.get(lead.setor);
  const porte = porteDeFuncionarios(lead.funcionarios);
  const base = setor?.ticketBase ?? 36000;
  return Math.round(base * porte.multiplicadorTicket);
}

/**
 * Urgencia (0-1): sinais quentes perdem valor rapido, e lead parado na fila
 * tambem. Os dois efeitos empurram o lead para cima da fila.
 */
export function calcularUrgencia(lead, avaliacao, referencia = new Date()) {
  const sinalMaisRecente = avaliacao.dimensoes.intencao.sinais[0];
  const frescorSinal = sinalMaisRecente ? sinalMaisRecente.frescor : 0;

  const ultimoToque = lead.ultimoContatoEm ? new Date(lead.ultimoContatoEm) : null;
  const diasSemToque = ultimoToque ? (referencia.getTime() - ultimoToque.getTime()) / DIA_MS : null;
  // Lead nunca contatado e urgente; contatado ha 10+ dias volta a ser urgente.
  const pressaoFollowUp = diasSemToque === null ? 0.8 : Math.min(diasSemToque / 10, 1);

  return Number(Math.min(1, frescorSinal * 0.6 + pressaoFollowUp * 0.4).toFixed(3));
}

/**
 * Decide a proxima acao concreta. As regras sao avaliadas em ordem -- a primeira
 * que casar vence, entao as mais especificas vem antes.
 */
export function proximaAcao(lead, avaliacao, referencia = new Date()) {
  const sinais = avaliacao.dimensoes.intencao.sinais;
  const temSinal = (tipo, dias) => sinais.some((s) => s.tipo === tipo && s.diasAtras <= dias);
  const acesso = avaliacao.dimensoes.acessibilidade;
  const diasSemToque = lead.ultimoContatoEm
    ? Math.floor((referencia.getTime() - new Date(lead.ultimoContatoEm).getTime()) / DIA_MS)
    : null;

  if (avaliacao.bloqueado) {
    return { acao: 'descartar', canal: null, prazoDias: 0, justificativa: 'Lead bate em criterio de bloqueio do ICP' };
  }
  if (ESTAGIOS_ENCERRADOS.has(lead.estagio)) {
    return { acao: 'arquivar', canal: null, prazoDias: 0, justificativa: `Lead ja esta em "${lead.estagio}"` };
  }
  if (temSinal('demo_solicitada', 3) || temSinal('respondeu_email', 2)) {
    return { acao: 'ligar_agora', canal: 'telefone', prazoDias: 0, justificativa: 'Resposta ou pedido de demo nas ultimas 72h: velocidade define a conversao' };
  }
  if (temSinal('visitou_precos', 5)) {
    return { acao: 'abordagem_direta', canal: acesso.canais.telefone ? 'telefone' : 'email', prazoDias: 1, justificativa: 'Visitou a pagina de precos ha menos de 5 dias' };
  }
  if (temSinal('rodada_investimento', 90) || temSinal('nova_lideranca', 60)) {
    return { acao: 'abordagem_por_gatilho', canal: 'linkedin', prazoDias: 2, justificativa: 'Janela de mudanca aberta: novo orcamento ou nova agenda de prioridades' };
  }
  if (avaliacao.tier === 'A') {
    return { acao: 'sequencia_personalizada', canal: 'email', prazoDias: 1, justificativa: 'Tier A: vale o custo de uma abordagem escrita a mao' };
  }
  if (diasSemToque !== null && diasSemToque >= 12) {
    return { acao: 'reativar', canal: 'email', prazoDias: 2, justificativa: `Sem contato ha ${diasSemToque} dias` };
  }
  if (!acesso.cargoNoAlvo) {
    return { acao: 'mapear_decisor', canal: 'linkedin', prazoDias: 4, justificativa: 'Contato atual nao decide: buscar caminho ate o decisor' };
  }
  if (avaliacao.tier === 'B') {
    return { acao: 'sequencia_padrao', canal: 'email', prazoDias: 3, justificativa: 'Tier B: cadencia com personalizacao leve' };
  }
  if (avaliacao.tier === 'C') {
    return { acao: 'nutrir', canal: 'email', prazoDias: 14, justificativa: 'Tier C: manter aquecido com conteudo ate aparecer sinal' };
  }
  return { acao: 'monitorar', canal: null, prazoDias: 30, justificativa: 'Tier D: fora da fila ativa, so observar sinais' };
}

/**
 * Avalia e ordena a carteira inteira.
 *
 * O criterio de ordenacao e score ajustado por urgencia -- nao o score puro.
 * Dois leads 80 em que um esfriou e o outro visitou o preco ontem nao devem
 * ocupar a mesma posicao na fila.
 */
export function priorizar(leads, icp, opcoes = {}) {
  const referencia = opcoes.referencia ?? new Date();
  const incluirEncerrados = opcoes.incluirEncerrados ?? false;

  const avaliados = leads
    .filter((lead) => incluirEncerrados || !ESTAGIOS_ENCERRADOS.has(lead.estagio))
    .map((lead) => {
      const avaliacao = avaliarLead(lead, icp, referencia);
      const urgencia = calcularUrgencia(lead, avaliacao, referencia);
      const valor = valorPotencial(lead);
      return {
        ...lead,
        avaliacao,
        score: avaliacao.score,
        tier: avaliacao.tier,
        urgencia,
        valorPotencial: valor,
        // 30% de reforco maximo por urgencia: importa, mas nao inverte o ranking.
        scorePrioridade: Number((avaliacao.score * (1 + urgencia * 0.3)).toFixed(2)),
        proximaAcao: proximaAcao(lead, avaliacao, referencia),
      };
    });

  avaliados.sort((a, b) =>
    b.scorePrioridade - a.scorePrioridade
    || b.valorPotencial - a.valorPotencial
    || a.empresa.localeCompare(b.empresa, 'pt-BR'));

  return avaliados.map((lead, indice) => ({ ...lead, posicao: indice + 1 }));
}

/**
 * Monta a fila do dia respeitando a capacidade do time.
 *
 * Reserva explicita por tier evita o vicio classico do ranking puro: o time so
 * trabalha tier A, o funil de medio prazo seca e tres meses depois o mes fecha
 * vazio. A reserva garante alimentacao continua do topo do funil.
 */
export function montarFilaDoDia(priorizados, opcoes = {}) {
  const capacidade = opcoes.capacidade ?? 25;
  const reserva = opcoes.reserva ?? { A: 0.5, B: 0.3, C: 0.2 };

  const disponiveis = priorizados.filter((l) => !['descartar', 'arquivar', 'monitorar'].includes(l.proximaAcao.acao));
  const porTier = { A: [], B: [], C: [], D: [] };
  for (const lead of disponiveis) porTier[lead.tier].push(lead);

  const fila = [];
  for (const [tier, fatia] of Object.entries(reserva)) {
    const cota = Math.round(capacidade * fatia);
    fila.push(...porTier[tier].slice(0, cota));
  }

  // Sobra de cota (ex.: poucos leads tier A hoje) e preenchida por ordem geral,
  // para nao devolver uma fila menor que a capacidade sem necessidade.
  if (fila.length < capacidade) {
    const jaNaFila = new Set(fila.map((l) => l.id));
    for (const lead of disponiveis) {
      if (fila.length >= capacidade) break;
      if (!jaNaFila.has(lead.id)) fila.push(lead);
    }
  }

  return fila
    .slice(0, capacidade)
    .sort((a, b) => a.proximaAcao.prazoDias - b.proximaAcao.prazoDias || b.scorePrioridade - a.scorePrioridade);
}

/** Resumo agregado da carteira para o painel. */
export function resumirCarteira(priorizados) {
  const porTier = { A: 0, B: 0, C: 0, D: 0 };
  const porEstagio = Object.fromEntries(ESTAGIOS.map((e) => [e, 0]));
  const porSetor = {};
  let valorTotal = 0;
  let somaScore = 0;

  for (const lead of priorizados) {
    porTier[lead.tier] += 1;
    if (lead.estagio in porEstagio) porEstagio[lead.estagio] += 1;
    porSetor[lead.setor] = (porSetor[lead.setor] ?? 0) + 1;
    valorTotal += lead.valorPotencial;
    somaScore += lead.score;
  }

  const total = priorizados.length;
  return {
    total,
    porTier,
    porEstagio,
    porSetor,
    valorTotal,
    scoreMedio: total > 0 ? Number((somaScore / total).toFixed(1)) : 0,
    ticketMedio: total > 0 ? Math.round(valorTotal / total) : 0,
    prontosParaAcao: priorizados.filter((l) => l.proximaAcao.prazoDias <= 1).length,
  };
}

export { PORTE_POR_ID };
