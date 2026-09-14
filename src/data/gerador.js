/**
 * Gerador de carteira sintetica.
 *
 * Existe para o projeto ser demonstravel no primeiro clone, sem base de dados e
 * sem credencial nenhuma. Os dados sao ficticios, mas a distribuicao nao e
 * uniforme: a maioria dos leads e mediana, uma minoria e otima e uma parte e
 * claramente ruim -- que e como uma carteira real se parece. Uniformizar isso
 * faria o motor de scoring parecer bom sem provar nada.
 */

import { createRng } from '../lib/rng.js';
import { SETORES, PORTES, CARGOS, TECNOLOGIAS, REGIOES, SINAIS } from './taxonomy.js';
import { ESTAGIOS } from '../core/priorizacao.js';

const PREFIXOS = ['Nova', 'Grupo', 'Alpha', 'Prime', 'Vetor', 'Norte', 'Orion', 'Vertex', 'Delta', 'Atlas', 'Lumen', 'Vale', 'Mundo', 'Forte', 'Clara', 'Rota', 'Base', 'Nexo', 'Solo', 'Onda'];
const NUCLEOS = ['Tech', 'Log', 'Med', 'Pay', 'Store', 'Lab', 'Data', 'Care', 'Flux', 'Move', 'Work', 'Farm', 'Build', 'Learn', 'Trade', 'Shop', 'Soft', 'Sys', 'Hub', 'Link'];
const SUFIXOS = ['', ' Brasil', ' Solucoes', ' Servicos', ' Digital', ' Industria', ' Group', ' Consultoria'];

const NOMES = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'Joao', 'Karina', 'Lucas', 'Mariana', 'Nelson', 'Olivia', 'Paulo', 'Renata', 'Rafael', 'Sofia', 'Thiago', 'Vanessa', 'Wagner', 'Yara', 'Marcos', 'Beatriz', 'Caio'];
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Rodrigues', 'Martins', 'Barbosa', 'Ribeiro', 'Carvalho', 'Gomes', 'Lima', 'Araujo', 'Monteiro', 'Moreira'];

const CIDADES = {
  sudeste: ['Sao Paulo', 'Campinas', 'Rio de Janeiro', 'Belo Horizonte', 'Vitoria', 'Ribeirao Preto'],
  sul: ['Curitiba', 'Porto Alegre', 'Florianopolis', 'Joinville', 'Londrina', 'Caxias do Sul'],
  nordeste: ['Recife', 'Salvador', 'Fortaleza', 'Natal', 'Joao Pessoa', 'Maceio'],
  centro_oeste: ['Goiania', 'Brasilia', 'Cuiaba', 'Campo Grande'],
  norte: ['Manaus', 'Belem', 'Porto Velho', 'Palmas'],
};

/**
 * Arquetipos de lead, com o peso de ocorrencia na carteira.
 * Cada arquetipo controla o quanto o lead adere ao ICP e quanta intencao mostra.
 */
const ARQUETIPOS = [
  { id: 'quente', peso: 8, fit: 0.92, sinais: [4, 7], recencia: [0, 8] },
  { id: 'bom_frio', peso: 20, fit: 0.85, sinais: [0, 2], recencia: [20, 90] },
  { id: 'mediano', peso: 38, fit: 0.55, sinais: [1, 3], recencia: [5, 60] },
  { id: 'curioso_sem_fit', peso: 14, fit: 0.2, sinais: [3, 6], recencia: [0, 15] },
  { id: 'fora_do_perfil', peso: 20, fit: 0.12, sinais: [0, 1], recencia: [30, 120] },
];

const slug = (texto) => texto
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Gera uma carteira deterministica.
 * @param {object} opcoes { quantidade, semente, referencia }
 */
export function gerarCarteira(opcoes = {}) {
  const quantidade = opcoes.quantidade ?? 200;
  const semente = opcoes.semente ?? 'prospecto';
  const referencia = opcoes.referencia ?? new Date();
  const rng = createRng(semente);

  const usados = new Set();
  const leads = [];

  for (let i = 0; i < quantidade; i += 1) {
    const arquetipo = rng.weighted(ARQUETIPOS.map((a) => ({ value: a, weight: a.peso })));
    const lead = gerarLead(rng, arquetipo, referencia, usados, i);
    leads.push(lead);
  }

  return leads;
}

function gerarLead(rng, arquetipo, referencia, usados, indice) {
  const empresa = nomeUnico(rng, usados);
  const dominio = `${slug(empresa)}.com.br`;

  // Leads com fit alto caem nos setores/regioes do ICP padrao; os demais se
  // espalham pelo resto do mercado.
  const setoresPreferidos = ['saas', 'ecommerce', 'servicos', 'saude', 'logistica'];
  const setor = rng.chance(arquetipo.fit)
    ? rng.pick(SETORES.filter((s) => setoresPreferidos.includes(s.id))).id
    : rng.pick(SETORES).id;

  const funcionarios = rng.chance(arquetipo.fit)
    ? Math.round(rng.normal(120, 70, 12, 480))
    : rng.chance(0.5)
      ? rng.int(2, 25)
      : rng.int(600, 6000);

  // Receita por funcionario varia por setor, com ruido -- nao e uma constante.
  const receitaPorFuncionario = rng.normal(180_000, 70_000, 45_000, 520_000);
  const receitaAnual = Math.round((funcionarios * receitaPorFuncionario) / 10_000) * 10_000;

  const regiao = rng.chance(arquetipo.fit)
    ? rng.weighted(REGIOES.slice(0, 3).map((r) => ({ value: r.id, weight: r.densidade })))
    : rng.weighted(REGIOES.map((r) => ({ value: r.id, weight: r.densidade })));

  const stackAlvo = ['hubspot', 'rd-station', 'pipedrive', 'salesforce', 'zapier', 'make', 'n8n'];
  const quantidadeTech = rng.int(1, 6);
  const tecnologias = rng.chance(arquetipo.fit)
    ? [...new Set([...rng.sample(stackAlvo, rng.int(1, 3)), ...rng.sample(TECNOLOGIAS, quantidadeTech)])]
    : rng.sample(TECNOLOGIAS.filter((t) => !stackAlvo.includes(t)), quantidadeTech);

  const maturidadeDigital = Math.max(1, Math.min(5,
    Math.round(rng.normal(arquetipo.fit >= 0.8 ? 4.1 : 2.8, 0.9, 1, 5))));

  const cargosAlvo = ['cro', 'ceo', 'head_vendas', 'cmo', 'head_marketing', 'gerente_comercial', 'coo'];
  const cargo = rng.chance(arquetipo.fit * 0.85 + 0.1)
    ? rng.pick(cargosAlvo)
    : rng.pick(CARGOS).id;

  const nome = `${rng.pick(NOMES)} ${rng.pick(SOBRENOMES)}`;
  const contato = {
    nome,
    cargo,
    // Nem todo contato tem todos os canais -- e o que torna a acessibilidade
    // uma dimensao de verdade em vez de uma constante.
    email: rng.chance(0.93) ? `${slug(nome.split(' ')[0])}.${slug(nome.split(' ')[1])}@${dominio}` : null,
    telefone: rng.chance(0.55) ? `+55 ${rng.int(11, 85)} 9${rng.int(1000, 9999)}-${rng.int(1000, 9999)}` : null,
    linkedin: rng.chance(0.72) ? `linkedin.com/in/${slug(nome)}-${rng.int(100, 999)}` : null,
  };

  const sinais = gerarSinais(rng, arquetipo, referencia);

  // Estagio correlaciona com engajamento: quem tem sinal quente ja foi tocado.
  const estagio = sinais.length >= 4
    ? rng.weighted([{ value: 'engajado', weight: 5 }, { value: 'reuniao', weight: 3 }, { value: 'oportunidade', weight: 2 }])
    : sinais.length >= 1
      ? rng.weighted([{ value: 'novo', weight: 4 }, { value: 'contatado', weight: 5 }, { value: 'engajado', weight: 2 }])
      : rng.weighted([{ value: 'novo', weight: 8 }, { value: 'contatado', weight: 2 }]);

  const diasUltimoContato = estagio === 'novo' ? null : rng.int(1, 45);
  const ultimoContatoEm = diasUltimoContato === null
    ? null
    : new Date(referencia.getTime() - diasUltimoContato * 86_400_000).toISOString();

  return {
    id: `LD-${String(indice + 1).padStart(5, '0')}`,
    empresa,
    dominio,
    setor,
    funcionarios,
    receitaAnual,
    regiao,
    cidade: rng.pick(CIDADES[regiao]),
    tecnologias,
    maturidadeDigital,
    contato,
    sinais,
    estagio,
    ultimoContatoEm,
    origem: rng.weighted([
      { value: 'inbound', weight: 3 },
      { value: 'lista_fria', weight: 4 },
      { value: 'indicacao', weight: 1 },
      { value: 'evento', weight: 1 },
      { value: 'parceiro', weight: 1 },
    ]),
    criadoEm: new Date(referencia.getTime() - rng.int(1, 300) * 86_400_000).toISOString(),
    arquetipo: arquetipo.id,
  };
}

function gerarSinais(rng, arquetipo, referencia) {
  const quantidade = rng.int(arquetipo.sinais[0], arquetipo.sinais[1]);
  const tipos = rng.sample(SINAIS.map((s) => s.id), quantidade);

  return tipos.map((tipo) => {
    const dias = rng.int(arquetipo.recencia[0], arquetipo.recencia[1]);
    return {
      tipo,
      data: new Date(referencia.getTime() - dias * 86_400_000).toISOString(),
      intensidade: Number(rng.float(0.8, 1.2).toFixed(2)),
    };
  }).sort((a, b) => new Date(b.data) - new Date(a.data));
}

function nomeUnico(rng, usados) {
  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const nome = `${rng.pick(PREFIXOS)}${rng.pick(NUCLEOS)}${rng.pick(SUFIXOS)}`;
    if (!usados.has(nome)) {
      usados.add(nome);
      return nome;
    }
  }
  const fallback = `${rng.pick(PREFIXOS)}${rng.pick(NUCLEOS)} ${usados.size + 1}`;
  usados.add(fallback);
  return fallback;
}

export { ESTAGIOS };
