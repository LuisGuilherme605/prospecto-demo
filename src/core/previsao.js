/**
 * Previsao de pipeline.
 *
 * O objetivo nao e acertar o numero exato -- e dar ao gestor uma faixa honesta e
 * a conta de quanto falta para bater a meta. Por isso toda projecao sai com
 * cenario conservador, base e otimista, e a probabilidade e composta por etapa
 * em vez de um "30% de chance" chutado sobre o total.
 */

import { SETOR_POR_ID, porteDeFuncionarios } from '../data/taxonomy.js';
import { valorPotencial } from './priorizacao.js';

/**
 * Taxas de conversao por etapa e por tier, calibradas para prospeccao ativa B2B.
 * Sao premissas explicitas: se a operacao tiver historico proprio, substitua
 * este objeto e a projecao inteira se recalibra.
 */
export const TAXAS_POR_TIER = {
  A: { contato: 0.62, resposta: 0.34, reuniao: 0.55, oportunidade: 0.58, fechamento: 0.34 },
  B: { contato: 0.52, resposta: 0.22, reuniao: 0.44, oportunidade: 0.48, fechamento: 0.26 },
  C: { contato: 0.41, resposta: 0.12, reuniao: 0.33, oportunidade: 0.38, fechamento: 0.18 },
  D: { contato: 0.28, resposta: 0.05, reuniao: 0.22, oportunidade: 0.28, fechamento: 0.11 },
};

/** Progresso ja conquistado: um lead em reuniao nao repete as etapas anteriores. */
const ETAPAS_CONCLUIDAS = {
  novo: [],
  contatado: ['contato'],
  engajado: ['contato', 'resposta'],
  reuniao: ['contato', 'resposta', 'reuniao'],
  oportunidade: ['contato', 'resposta', 'reuniao', 'oportunidade'],
  ganho: ['contato', 'resposta', 'reuniao', 'oportunidade', 'fechamento'],
  perdido: [],
};

const ORDEM_ETAPAS = ['contato', 'resposta', 'reuniao', 'oportunidade', 'fechamento'];

/**
 * Probabilidade de fechamento de um lead, composta pelas etapas que ainda faltam.
 * O score modula as taxas em ate +-25% -- um lead 92 dentro do tier A converte
 * melhor que um 79 do mesmo tier.
 */
export function probabilidadeDeFechamento(lead) {
  if (lead.estagio === 'perdido') return 0;
  if (lead.estagio === 'ganho') return 1;

  const taxas = TAXAS_POR_TIER[lead.tier] ?? TAXAS_POR_TIER.D;
  const concluidas = new Set(ETAPAS_CONCLUIDAS[lead.estagio] ?? []);
  const modulador = 0.75 + (lead.score / 100) * 0.5;

  let probabilidade = 1;
  for (const etapa of ORDEM_ETAPAS) {
    if (concluidas.has(etapa)) continue;
    probabilidade *= Math.min(0.95, taxas[etapa] * modulador);
  }
  return Number(probabilidade.toFixed(4));
}

/** Data provavel de fechamento, a partir do ciclo do setor e do estagio atual. */
export function previsaoDeFechamento(lead, referencia = new Date()) {
  const setor = SETOR_POR_ID.get(lead.setor);
  const cicloBase = setor?.cicloDias ?? 60;
  const porte = porteDeFuncionarios(lead.funcionarios);
  // Empresa maior decide mais devagar: mais gente na mesa.
  const fatorPorte = 0.75 + porte.multiplicadorTicket * 0.25;
  const progresso = (ETAPAS_CONCLUIDAS[lead.estagio] ?? []).length / ORDEM_ETAPAS.length;
  const diasRestantes = Math.round(cicloBase * fatorPorte * (1 - progresso * 0.8));
  return {
    diasRestantes,
    dataPrevista: new Date(referencia.getTime() + diasRestantes * 86_400_000).toISOString().slice(0, 10),
  };
}

/**
 * Projeta o pipeline da carteira priorizada.
 *
 * @param {Array} priorizados saida de `priorizar`
 * @param {object} opcoes { referencia, horizonteDias, meta }
 */
export function projetarPipeline(priorizados, opcoes = {}) {
  const referencia = opcoes.referencia ?? new Date();
  const horizonteDias = opcoes.horizonteDias ?? 90;
  const meta = opcoes.meta ?? 0;

  const itens = priorizados
    .filter((lead) => lead.estagio !== 'perdido')
    .map((lead) => {
      const valor = lead.valorPotencial ?? valorPotencial(lead);
      const probabilidade = probabilidadeDeFechamento(lead);
      const previsao = previsaoDeFechamento(lead, referencia);
      return {
        id: lead.id,
        empresa: lead.empresa,
        tier: lead.tier,
        estagio: lead.estagio,
        valor,
        probabilidade,
        valorPonderado: Math.round(valor * probabilidade),
        ...previsao,
        dentroDoHorizonte: previsao.diasRestantes <= horizonteDias,
      };
    });

  const noHorizonte = itens.filter((i) => i.dentroDoHorizonte);
  const valorPonderado = noHorizonte.reduce((soma, i) => soma + i.valorPonderado, 0);
  const valorBruto = noHorizonte.reduce((soma, i) => soma + i.valor, 0);

  // Faixa por propagacao de variancia de Bernoulli: soma de p*(1-p)*valor^2.
  // Mais honesto que aplicar +-20% fixo, porque a incerteza cresce com a
  // quantidade de negocios duvidosos, nao com o tamanho do pipeline.
  const variancia = noHorizonte.reduce((soma, i) => soma + i.probabilidade * (1 - i.probabilidade) * i.valor ** 2, 0);
  const desvio = Math.sqrt(variancia);

  const cenarios = {
    conservador: Math.max(0, Math.round(valorPonderado - desvio)),
    base: Math.round(valorPonderado),
    otimista: Math.round(valorPonderado + desvio),
  };

  const porTier = {};
  for (const item of noHorizonte) {
    const atual = porTier[item.tier] ?? { leads: 0, valor: 0, ponderado: 0 };
    atual.leads += 1;
    atual.valor += item.valor;
    atual.ponderado += item.valorPonderado;
    porTier[item.tier] = atual;
  }

  const topDeals = [...noHorizonte].sort((a, b) => b.valorPonderado - a.valorPonderado).slice(0, 10);

  return {
    horizonteDias,
    geradoEm: referencia.toISOString(),
    leadsConsiderados: noHorizonte.length,
    valorBruto,
    cenarios,
    desvio: Math.round(desvio),
    porTier,
    topDeals,
    meta: meta > 0 ? avaliarMeta(cenarios, porTier, meta, noHorizonte) : null,
  };
}

/**
 * Diz se a meta fecha e, se nao fechar, quanto falta em leads equivalentes --
 * a pergunta que o gestor realmente faz.
 */
function avaliarMeta(cenarios, porTier, meta, itens) {
  const lacuna = meta - cenarios.base;
  const ticketMedioPonderado = itens.length > 0
    ? itens.reduce((soma, i) => soma + i.valorPonderado, 0) / itens.length
    : 0;

  return {
    valor: meta,
    cobertura: Number((cenarios.base / meta).toFixed(2)),
    atingeNoBase: lacuna <= 0,
    atingeNoOtimista: meta <= cenarios.otimista,
    lacuna: Math.max(0, Math.round(lacuna)),
    leadsAdicionaisNecessarios: lacuna > 0 && ticketMedioPonderado > 0
      ? Math.ceil(lacuna / ticketMedioPonderado)
      : 0,
    diagnostico: lacuna <= 0
      ? 'Pipeline cobre a meta no cenario base'
      : meta <= cenarios.otimista
        ? 'Meta so fecha no cenario otimista: depende de nenhum negocio grande cair'
        : 'Pipeline insuficiente para a meta: falta volume de topo de funil, nao esforco de fechamento',
  };
}
