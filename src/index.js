/**
 * Superficie publica do Prospecto como biblioteca.
 *
 * Quem so quer o motor de scoring importa daqui e ignora servidor, banco e CLI:
 *
 *   import { avaliarLead, normalizarIcp } from 'prospecto';
 */

export { avaliarLead, calcularFit, calcularIntencao, calcularAcessibilidade, classificarTier, decaimento, proximidadeDeFaixa, formatarBRL } from './core/scoring.js';
export { ICP_PADRAO, normalizarIcp, descreverIcp, ErroDeValidacao } from './core/icp.js';
export { priorizar, montarFilaDoDia, resumirCarteira, proximaAcao, valorPotencial, calcularUrgencia, ESTAGIOS } from './core/priorizacao.js';
export { gerarCadencia, preencher, TRILHAS } from './core/cadencia.js';
export { projetarPipeline, probabilidadeDeFechamento, previsaoDeFechamento, TAXAS_POR_TIER } from './core/previsao.js';
export { gerarCarteira } from './data/gerador.js';
export { SETORES, PORTES, CARGOS, REGIOES, SINAIS, TECNOLOGIAS, porteDeFuncionarios } from './data/taxonomy.js';
export { Repositorio } from './store/repositorio.js';
export { criarServidor } from './server/servidor.js';
export { lerCsv, escreverCsv } from './lib/csv.js';
export { deduplicar, normalizarEmpresa, normalizarDominio } from './lib/dedup.js';
export { createRng } from './lib/rng.js';
