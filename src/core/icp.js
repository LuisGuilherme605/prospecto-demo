/**
 * Perfil de Cliente Ideal (ICP).
 *
 * O ICP e a unica fonte de verdade sobre "quem vale a pena". Todo o scoring le
 * daqui, entao mudar o ICP re-prioriza a carteira inteira sem tocar em codigo.
 */

import { SETOR_POR_ID, PORTE_POR_ID, REGIAO_POR_ID, CARGO_POR_ID } from '../data/taxonomy.js';

/** ICP padrao: PMEs digitalizadas, decisor em vendas/marketing. */
export const ICP_PADRAO = Object.freeze({
  nome: 'PME digitalizada - operacao comercial',
  setoresAlvo: ['saas', 'ecommerce', 'servicos', 'saude', 'logistica'],
  funcionariosIdeal: { min: 30, max: 300 },
  receitaAnualIdeal: { min: 3_000_000, max: 80_000_000 },
  regioesAlvo: ['sudeste', 'sul', 'nordeste'],
  tecnologiasAlvo: ['hubspot', 'rd-station', 'pipedrive', 'salesforce', 'zapier', 'make', 'n8n'],
  tecnologiasBloqueio: [],
  cargosAlvo: ['cro', 'ceo', 'head_vendas', 'cmo', 'head_marketing', 'gerente_comercial', 'coo'],
  maturidadeDigitalMinima: 3,
  pesos: {
    setor: 22,
    porte: 20,
    receita: 14,
    regiao: 8,
    tecnologia: 20,
    maturidade: 16,
  },
  // Como o score final combina as tres dimensoes. Precisa somar 1.
  composicao: { fit: 0.5, intencao: 0.35, acessibilidade: 0.15 },
  // Corte de tier sobre o score final (0-100).
  tiers: { A: 78, B: 62, C: 45 },
});

class ErroDeValidacao extends Error {
  constructor(problemas) {
    super(`ICP invalido: ${problemas.join('; ')}`);
    this.name = 'ErroDeValidacao';
    this.problemas = problemas;
  }
}

const quase = (a, b, tolerancia = 1e-9) => Math.abs(a - b) <= tolerancia;

/**
 * Valida e normaliza um ICP parcial contra o padrao.
 * Lanca `ErroDeValidacao` com a lista completa de problemas -- o objetivo e o
 * usuario corrigir tudo de uma vez, nao descobrir um erro por execucao.
 */
export function normalizarIcp(entrada = {}) {
  const icp = {
    ...ICP_PADRAO,
    ...entrada,
    funcionariosIdeal: { ...ICP_PADRAO.funcionariosIdeal, ...entrada.funcionariosIdeal },
    receitaAnualIdeal: { ...ICP_PADRAO.receitaAnualIdeal, ...entrada.receitaAnualIdeal },
    pesos: { ...ICP_PADRAO.pesos, ...entrada.pesos },
    composicao: { ...ICP_PADRAO.composicao, ...entrada.composicao },
    tiers: { ...ICP_PADRAO.tiers, ...entrada.tiers },
  };

  const problemas = [];
  const conferirIds = (lista, mapa, campo) => {
    for (const id of lista ?? []) {
      if (!mapa.has(id)) problemas.push(`${campo} desconhecido: "${id}"`);
    }
  };

  conferirIds(icp.setoresAlvo, SETOR_POR_ID, 'setor');
  conferirIds(icp.regioesAlvo, REGIAO_POR_ID, 'regiao');
  conferirIds(icp.cargosAlvo, CARGO_POR_ID, 'cargo');

  if (icp.funcionariosIdeal.min > icp.funcionariosIdeal.max) {
    problemas.push('funcionariosIdeal.min nao pode ser maior que max');
  }
  if (icp.receitaAnualIdeal.min > icp.receitaAnualIdeal.max) {
    problemas.push('receitaAnualIdeal.min nao pode ser maior que max');
  }
  if (Object.values(icp.pesos).some((p) => p < 0)) {
    problemas.push('pesos nao podem ser negativos');
  }
  if (Object.values(icp.pesos).reduce((a, b) => a + b, 0) <= 0) {
    problemas.push('a soma dos pesos precisa ser maior que zero');
  }

  const somaComposicao = icp.composicao.fit + icp.composicao.intencao + icp.composicao.acessibilidade;
  if (!quase(somaComposicao, 1, 1e-6)) {
    problemas.push(`composicao precisa somar 1 (soma atual: ${somaComposicao.toFixed(3)})`);
  }
  if (!(icp.tiers.A > icp.tiers.B && icp.tiers.B > icp.tiers.C)) {
    problemas.push('os cortes de tier precisam ser decrescentes: A > B > C');
  }

  const sobreposicao = (icp.tecnologiasAlvo ?? []).filter((t) => (icp.tecnologiasBloqueio ?? []).includes(t));
  if (sobreposicao.length > 0) {
    problemas.push(`tecnologia listada como alvo e bloqueio ao mesmo tempo: ${sobreposicao.join(', ')}`);
  }

  if (problemas.length > 0) throw new ErroDeValidacao(problemas);
  return Object.freeze(icp);
}

export function descreverIcp(icp) {
  const setores = icp.setoresAlvo.map((id) => SETOR_POR_ID.get(id).nome).join(', ');
  const portes = `${icp.funcionariosIdeal.min}-${icp.funcionariosIdeal.max} funcionarios`;
  const regioes = icp.regioesAlvo.map((id) => REGIAO_POR_ID.get(id).nome).join(', ');
  return `${icp.nome}: ${setores} | ${portes} | ${regioes}`;
}

export { ErroDeValidacao, PORTE_POR_ID };
