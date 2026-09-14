/**
 * Vocabulario controlado do dominio de prospeccao.
 *
 * Tudo que o motor entende sobre o mercado esta aqui: setores, faixas de porte,
 * cargos com o respectivo poder de decisao, stack tecnologica e tipos de sinal.
 * Manter isso centralizado evita string solta espalhada pelo codigo e permite
 * trocar o mercado-alvo sem mexer em regra de negocio.
 */

/** Setores com ticket medio anual de referencia (BRL) e ciclo de venda em dias. */
export const SETORES = [
  { id: 'saas', nome: 'SaaS e Software', ticketBase: 48000, cicloDias: 45 },
  { id: 'ecommerce', nome: 'E-commerce e Varejo', ticketBase: 36000, cicloDias: 38 },
  { id: 'servicos', nome: 'Servicos Profissionais', ticketBase: 30000, cicloDias: 52 },
  { id: 'industria', nome: 'Industria e Manufatura', ticketBase: 72000, cicloDias: 96 },
  { id: 'saude', nome: 'Saude e Bem-estar', ticketBase: 54000, cicloDias: 88 },
  { id: 'educacao', nome: 'Educacao', ticketBase: 27000, cicloDias: 70 },
  { id: 'financeiro', nome: 'Financeiro e Seguros', ticketBase: 96000, cicloDias: 120 },
  { id: 'logistica', nome: 'Logistica e Transporte', ticketBase: 60000, cicloDias: 76 },
  { id: 'construcao', nome: 'Construcao e Imobiliario', ticketBase: 42000, cicloDias: 84 },
  { id: 'agro', nome: 'Agronegocio', ticketBase: 66000, cicloDias: 92 },
];

/** Faixas de porte por numero de funcionarios. */
export const PORTES = [
  { id: 'micro', nome: 'Micro', min: 1, max: 9, multiplicadorTicket: 0.35 },
  { id: 'pequena', nome: 'Pequena', min: 10, max: 49, multiplicadorTicket: 0.7 },
  { id: 'media', nome: 'Media', min: 50, max: 199, multiplicadorTicket: 1.0 },
  { id: 'media_grande', nome: 'Media-grande', min: 200, max: 499, multiplicadorTicket: 1.6 },
  { id: 'grande', nome: 'Grande', min: 500, max: 20000, multiplicadorTicket: 2.8 },
];

/**
 * Cargos e o peso de decisao de cada um (0 a 1).
 * `poder` mede quanto a pessoa decide sozinha; `alcance` mede a facilidade de
 * conseguir uma resposta dela -- um CEO decide muito, mas responde pouco.
 */
export const CARGOS = [
  { id: 'ceo', nome: 'CEO / Socio-fundador', poder: 1.0, alcance: 0.45, nivel: 'executivo' },
  { id: 'coo', nome: 'Diretor de Operacoes', poder: 0.85, alcance: 0.55, nivel: 'executivo' },
  { id: 'cfo', nome: 'Diretor Financeiro', poder: 0.85, alcance: 0.5, nivel: 'executivo' },
  { id: 'cmo', nome: 'Diretor de Marketing', poder: 0.8, alcance: 0.6, nivel: 'executivo' },
  { id: 'cro', nome: 'Diretor Comercial', poder: 0.9, alcance: 0.6, nivel: 'executivo' },
  { id: 'cto', nome: 'Diretor de Tecnologia', poder: 0.8, alcance: 0.5, nivel: 'executivo' },
  { id: 'head_vendas', nome: 'Head de Vendas', poder: 0.7, alcance: 0.75, nivel: 'lideranca' },
  { id: 'head_marketing', nome: 'Head de Marketing', poder: 0.65, alcance: 0.78, nivel: 'lideranca' },
  { id: 'gerente_comercial', nome: 'Gerente Comercial', poder: 0.5, alcance: 0.8, nivel: 'lideranca' },
  { id: 'gerente_ti', nome: 'Gerente de TI', poder: 0.45, alcance: 0.72, nivel: 'lideranca' },
  { id: 'coordenador', nome: 'Coordenador', poder: 0.28, alcance: 0.85, nivel: 'operacional' },
  { id: 'analista', nome: 'Analista', poder: 0.12, alcance: 0.9, nivel: 'operacional' },
];

/** Tecnologias observaveis no site/stack da empresa. */
export const TECNOLOGIAS = [
  'hubspot', 'salesforce', 'rd-station', 'pipedrive', 'zendesk', 'intercom',
  'shopify', 'vtex', 'woocommerce', 'nuvemshop', 'sap', 'totvs', 'omie',
  'google-analytics', 'segment', 'metabase', 'power-bi', 'looker',
  'aws', 'gcp', 'azure', 'zapier', 'make', 'n8n', 'twilio', 'whatsapp-business',
];

/** Regioes com um fator de densidade de mercado. */
export const REGIOES = [
  { id: 'sudeste', nome: 'Sudeste', densidade: 1.0 },
  { id: 'sul', nome: 'Sul', densidade: 0.82 },
  { id: 'nordeste', nome: 'Nordeste', densidade: 0.68 },
  { id: 'centro_oeste', nome: 'Centro-Oeste', densidade: 0.6 },
  { id: 'norte', nome: 'Norte', densidade: 0.42 },
];

/**
 * Catalogo de sinais de intencao.
 *
 * `peso` e a contribuicao bruta do sinal (0 a 100 antes da normalizacao) e
 * `meiaVidaDias` define em quantos dias metade desse peso evapora. Um sinal forte
 * mas antigo vale menos que um sinal medio de ontem -- isso e o que separa uma
 * lista de leads de uma fila de trabalho.
 */
export const SINAIS = [
  { id: 'respondeu_email', nome: 'Respondeu a um e-mail', peso: 100, meiaVidaDias: 21, categoria: 'engajamento' },
  { id: 'reuniao_realizada', nome: 'Participou de reuniao', peso: 95, meiaVidaDias: 45, categoria: 'engajamento' },
  { id: 'visitou_precos', nome: 'Visitou a pagina de precos', peso: 82, meiaVidaDias: 10, categoria: 'compra' },
  { id: 'demo_solicitada', nome: 'Solicitou demonstracao', peso: 98, meiaVidaDias: 30, categoria: 'compra' },
  { id: 'baixou_material', nome: 'Baixou material rico', peso: 58, meiaVidaDias: 14, categoria: 'conteudo' },
  { id: 'visita_recorrente', nome: 'Visitas recorrentes ao site', peso: 62, meiaVidaDias: 9, categoria: 'compra' },
  { id: 'abriu_email', nome: 'Abriu e-mail da cadencia', peso: 26, meiaVidaDias: 7, categoria: 'engajamento' },
  { id: 'clicou_email', nome: 'Clicou em link do e-mail', peso: 44, meiaVidaDias: 8, categoria: 'engajamento' },
  { id: 'vaga_aberta', nome: 'Abriu vaga na area-alvo', peso: 70, meiaVidaDias: 40, categoria: 'crescimento' },
  { id: 'rodada_investimento', nome: 'Captou investimento', peso: 88, meiaVidaDias: 120, categoria: 'crescimento' },
  { id: 'nova_lideranca', nome: 'Trocou lideranca da area', peso: 76, meiaVidaDias: 75, categoria: 'mudanca' },
  { id: 'expansao_unidade', nome: 'Abriu nova unidade', peso: 64, meiaVidaDias: 90, categoria: 'crescimento' },
  { id: 'usa_concorrente', nome: 'Usa solucao concorrente', peso: 72, meiaVidaDias: 180, categoria: 'mudanca' },
  { id: 'evento_setor', nome: 'Presente em evento do setor', peso: 40, meiaVidaDias: 35, categoria: 'conteudo' },
  { id: 'menciona_dor', nome: 'Mencionou a dor publicamente', peso: 68, meiaVidaDias: 25, categoria: 'conteudo' },
];

const porId = (lista) => new Map(lista.map((item) => [item.id, item]));

export const SETOR_POR_ID = porId(SETORES);
export const PORTE_POR_ID = porId(PORTES);
export const CARGO_POR_ID = porId(CARGOS);
export const REGIAO_POR_ID = porId(REGIOES);
export const SINAL_POR_ID = porId(SINAIS);

/** Descobre a faixa de porte a partir do numero de funcionarios. */
export function porteDeFuncionarios(funcionarios) {
  return PORTES.find((p) => funcionarios >= p.min && funcionarios <= p.max) ?? PORTES[PORTES.length - 1];
}
