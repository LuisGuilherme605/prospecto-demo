#!/usr/bin/env node
/**
 * CLI do Prospecto.
 *
 * A linha de comando e a interface primaria: o time comercial pode rodar
 * `prospecto fila` toda manha e receber a lista de trabalho do dia sem abrir
 * navegador nenhum. O painel web e a mesma informacao para quem prefere clicar.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { Repositorio } from '../src/store/repositorio.js';
import { gerarCarteira } from '../src/data/gerador.js';
import { priorizar, montarFilaDoDia, resumirCarteira } from '../src/core/priorizacao.js';
import { projetarPipeline } from '../src/core/previsao.js';
import { gerarCadencia } from '../src/core/cadencia.js';
import { descreverIcp, ErroDeValidacao } from '../src/core/icp.js';
import { criarServidor } from '../src/server/servidor.js';
import { exigirConfiguracaoSegura } from '../src/server/autenticacao.js';
import { lerCsv, escreverCsv } from '../src/lib/csv.js';
import { deduplicar } from '../src/lib/dedup.js';
import { SETOR_POR_ID, REGIAO_POR_ID, CARGO_POR_ID } from '../src/data/taxonomy.js';
import { cor, COR_TIER, tabela, barra, titulo, moeda } from '../src/lib/terminal.js';

const OPCOES = {
  banco: { type: 'string', default: process.env.PROSPECTO_BANCO ?? 'data/prospecto.db' },
  quantidade: { type: 'string', default: process.env.PROSPECTO_QUANTIDADE ?? '200' },
  semente: { type: 'string', default: 'prospecto' },
  limite: { type: 'string', default: '20' },
  capacidade: { type: 'string', default: '25' },
  tier: { type: 'string' },
  setor: { type: 'string' },
  estagio: { type: 'string' },
  meta: { type: 'string', default: '0' },
  horizonte: { type: 'string', default: '90' },
  // As plataformas de hospedagem injetam a porta via ambiente e esperam que o
  // processo escute nela; ignorar PORT e a causa numero um de "deploy no ar mas
  // nao responde". A flag continua valendo mais que o ambiente, para uso local.
  porta: { type: 'string', default: process.env.PORT ?? '3000' },
  host: { type: 'string', default: process.env.HOST ?? '0.0.0.0' },
  remetente: { type: 'string', default: 'Luis' },
  empresa: { type: 'string', default: 'Prospecto' },
  saida: { type: 'string' },
  json: { type: 'boolean', default: false },
  forcar: { type: 'boolean', default: false },
  ajuda: { type: 'boolean', default: false, short: 'h' },
};

const AJUDA = `
${cor.negrito('prospecto')} - motor de prospeccao B2B com scoring explicavel

${cor.negrito('USO')}
  prospecto <comando> [opcoes]

${cor.negrito('COMANDOS')}
  demo                     Popula o banco e mostra o panorama completo (comece por aqui)
  semear                   Gera uma carteira sintetica deterministica
  importar <arquivo.csv>   Importa leads de um CSV, deduplicando na entrada
  ranking                  Lista os leads ordenados por prioridade
  fila                     Monta a fila de trabalho do dia respeitando a capacidade
  lead <id>                Abre um lead com o breakdown completo do score
  cadencia <id>            Gera a sequencia de contato pronta para revisao
  previsao                 Projeta o pipeline em tres cenarios
  resumo                   Panorama agregado da carteira
  icp                      Mostra o ICP em uso
  exportar                 Exporta a carteira priorizada em CSV
  servir                   Sobe o painel web e a API

${cor.negrito('OPCOES')}
  --banco <caminho>        Arquivo SQLite (padrao: data/prospecto.db)
  --quantidade <n>         Leads a gerar em "semear" (padrao: 200)
  --semente <texto>        Semente do gerador: a mesma semente da a mesma carteira
  --limite <n>             Linhas exibidas nas listagens (padrao: 20)
  --capacidade <n>         Tamanho da fila do dia (padrao: 25)
  --tier <A,B>             Filtra por tier
  --setor <id>             Filtra por setor
  --estagio <id>           Filtra por estagio do funil
  --meta <valor>           Meta de receita para o comando "previsao"
  --horizonte <dias>       Janela da previsao (padrao: 90)
  --porta <n>              Porta do servidor (padrao: 3000, ou $PORT)
  --host <endereco>        Interface de escuta (padrao: 0.0.0.0, ou $HOST)
  --remetente <nome>       Assinatura usada na cadencia
  --empresa <nome>         Empresa remetente usada na cadencia
  --saida <arquivo>        Arquivo de destino em "exportar"
  --json                   Saida em JSON, para encadear com outras ferramentas
  --forcar                 Sobrescreve a carteira existente em "semear"

${cor.negrito('EXEMPLOS')}
  prospecto demo
  prospecto semear --quantidade 500 --semente time-sp
  prospecto ranking --tier A,B --limite 15
  prospecto fila --capacidade 30
  prospecto cadencia LD-00042 --remetente "Luis Guilherme"
  prospecto previsao --meta 1500000 --horizonte 120
  prospecto servir --porta 3000

${cor.negrito('VARIAVEIS DE AMBIENTE')}
  PORT                     Porta do servidor
  HOST                     Interface de escuta
  PROSPECTO_BANCO          Caminho do arquivo SQLite
  PROSPECTO_SENHA          Senha do painel (obrigatoria fora do localhost)
  PROSPECTO_SEGREDO        Chave de assinatura da sessao; sem ela, as sessoes
                           caem a cada reinicio do processo
  PROSPECTO_ATRAS_DE_PROXY Defina como 1 quando houver proxy HTTPS na frente
                           (Caddy, Nginx, roteador da plataforma)
  PROSPECTO_SESSAO_HORAS   Validade da sessao (padrao: 12)
  PROSPECTO_QUANTIDADE     Tamanho da carteira gerada quando o banco esta vazio
  PROSPECTO_MODO_DEMO      Defina como 1 para uma demonstracao publica sem
                           senha. So use com a carteira sintetica: o painel
                           exibe aviso de dados ficticios e libera o botao de
                           restaurar a demonstracao
`;

async function principal() {
  const { values: opcoes, positionals } = parseArgs({
    args: process.argv.slice(2), options: OPCOES, allowPositionals: true, strict: false,
  });

  const [comando, argumento] = positionals;

  if (!comando || opcoes.ajuda || comando === 'ajuda') {
    console.log(AJUDA);
    return;
  }

  const comandos = {
    demo, semear, importar, ranking, fila, lead, cadencia, previsao, resumo, icp, exportar, servir,
  };

  const executar = comandos[comando];
  if (!executar) {
    console.error(cor.vermelho(`Comando desconhecido: "${comando}"`));
    console.error(`Rode ${cor.negrito('prospecto --ajuda')} para ver os comandos disponiveis.`);
    process.exitCode = 1;
    return;
  }

  await executar(opcoes, argumento);
}

/** Abre o repositorio e garante o fechamento mesmo em caso de erro. */
async function comRepositorio(opcoes, acao) {
  const repositorio = new Repositorio(opcoes.banco);
  try {
    return await acao(repositorio);
  } finally {
    repositorio.fechar();
  }
}

/** Carrega a carteira ja priorizada; avisa quando o banco esta vazio. */
function carregarPriorizados(repositorio) {
  const leads = repositorio.listarLeads();
  if (leads.length === 0) {
    console.log(cor.amarelo('Nenhum lead no banco.'));
    console.log(`Rode ${cor.negrito('prospecto demo')} para popular com uma carteira de exemplo.`);
    return null;
  }
  return priorizar(leads, repositorio.obterIcp());
}

async function demo(opcoes) {
  await semear({ ...opcoes, forcar: true, quantidade: opcoes.quantidade ?? '200' }, null, true);
  console.log(titulo('PANORAMA DA CARTEIRA'));
  await resumo(opcoes);
  console.log(titulo('FILA DE TRABALHO DE HOJE'));
  await fila({ ...opcoes, limite: '10' });
  console.log(titulo('PREVISAO DE PIPELINE'));
  await previsao({ ...opcoes, meta: opcoes.meta !== '0' ? opcoes.meta : '1500000' });
  console.log(`\n${cor.cinza('Proximos passos:')}`);
  console.log(`  ${cor.negrito('prospecto ranking --tier A')}   ver os melhores leads`);
  console.log(`  ${cor.negrito('prospecto cadencia <id>')}      gerar a sequencia de contato`);
  console.log(`  ${cor.negrito('prospecto servir')}             abrir o painel web\n`);
}

async function semear(opcoes, _argumento, silencioso = false) {
  await comRepositorio(opcoes, (repositorio) => {
    const existentes = repositorio.contarLeads();
    if (existentes > 0 && !opcoes.forcar) {
      console.log(cor.amarelo(`O banco ja tem ${existentes} leads.`));
      console.log(`Use ${cor.negrito('--forcar')} para substituir a carteira.`);
      return;
    }
    if (existentes > 0) repositorio.removerTodos();

    const quantidade = Number(opcoes.quantidade);
    const leads = gerarCarteira({ quantidade, semente: opcoes.semente });
    repositorio.salvarLeads(leads);
    if (!silencioso || true) {
      console.log(cor.verde(`${quantidade} leads gerados com a semente "${opcoes.semente}" em ${opcoes.banco}`));
    }
  });
}

async function importar(opcoes, arquivo) {
  if (!arquivo) {
    console.error(cor.vermelho('Informe o arquivo: prospecto importar leads.csv'));
    process.exitCode = 1;
    return;
  }

  const texto = await readFile(arquivo, 'utf8');
  const registros = lerCsv(texto);
  if (registros.length === 0) {
    console.error(cor.vermelho('O arquivo nao tem nenhuma linha de dados.'));
    process.exitCode = 1;
    return;
  }

  const { leads, problemas } = converterRegistros(registros);
  const resultado = deduplicar(leads);

  await comRepositorio(opcoes, (repositorio) => {
    repositorio.salvarLeads(resultado.unicos);
    console.log(cor.verde(`${resultado.unicos.length} leads importados de ${arquivo}`));
    if (resultado.removidos > 0) {
      console.log(cor.amarelo(`${resultado.removidos} duplicatas mescladas:`));
      for (const grupo of resultado.grupos.slice(0, 10)) {
        console.log(`  ${grupo.mantido} <- ${grupo.mesclados.join(', ')}`);
      }
    }
    if (problemas.length > 0) {
      console.log(cor.amarelo(`${problemas.length} linhas com campo faltando foram completadas com valor padrao:`));
      for (const problema of problemas.slice(0, 5)) console.log(`  linha ${problema.linha}: ${problema.aviso}`);
    }
  });
}

/** Converte linhas de CSV em leads, tolerando colunas ausentes. */
function converterRegistros(registros) {
  const problemas = [];
  const pegar = (registro, ...nomes) => {
    for (const nome of nomes) {
      const chave = Object.keys(registro).find((k) => k.toLowerCase().trim() === nome);
      if (chave && String(registro[chave]).trim() !== '') return String(registro[chave]).trim();
    }
    return '';
  };

  const leads = registros.map((registro, indice) => {
    const empresa = pegar(registro, 'empresa', 'company', 'nome', 'razao social');
    const setor = pegar(registro, 'setor', 'industry', 'segmento') || 'servicos';
    const funcionarios = Number(pegar(registro, 'funcionarios', 'employees', 'porte')) || 50;

    if (!empresa) problemas.push({ linha: indice + 2, aviso: 'sem nome de empresa' });
    if (!SETOR_POR_ID.has(setor)) problemas.push({ linha: indice + 2, aviso: `setor "${setor}" desconhecido, usando "servicos"` });

    const regiao = pegar(registro, 'regiao', 'region', 'estado') || 'sudeste';
    const email = pegar(registro, 'email', 'e-mail');
    const cargo = pegar(registro, 'cargo', 'title', 'role') || 'gerente_comercial';

    return {
      id: pegar(registro, 'id') || `IMP-${String(indice + 1).padStart(5, '0')}`,
      empresa: empresa || `Empresa sem nome ${indice + 1}`,
      dominio: pegar(registro, 'dominio', 'domain', 'site', 'website') || (email.includes('@') ? email.split('@')[1] : null),
      setor: SETOR_POR_ID.has(setor) ? setor : 'servicos',
      funcionarios,
      receitaAnual: Number(pegar(registro, 'receita', 'receita_anual', 'revenue')) || funcionarios * 180_000,
      regiao: REGIAO_POR_ID.has(regiao) ? regiao : 'sudeste',
      cidade: pegar(registro, 'cidade', 'city') || null,
      tecnologias: pegar(registro, 'tecnologias', 'stack', 'technologies').split(/[|,;]/).map((t) => t.trim()).filter(Boolean),
      maturidadeDigital: Number(pegar(registro, 'maturidade')) || 3,
      contato: {
        nome: pegar(registro, 'contato', 'nome_contato', 'contact') || null,
        cargo: CARGO_POR_ID.has(cargo) ? cargo : 'gerente_comercial',
        email: email || null,
        telefone: pegar(registro, 'telefone', 'phone', 'celular') || null,
        linkedin: pegar(registro, 'linkedin') || null,
      },
      sinais: [],
      estagio: pegar(registro, 'estagio', 'stage') || 'novo',
      origem: pegar(registro, 'origem', 'source') || 'importacao',
      criadoEm: new Date().toISOString(),
    };
  });

  return { leads, problemas };
}

async function ranking(opcoes) {
  await comRepositorio(opcoes, (repositorio) => {
    let lista = carregarPriorizados(repositorio);
    if (!lista) return;

    if (opcoes.tier) lista = lista.filter((l) => opcoes.tier.split(',').includes(l.tier));
    if (opcoes.setor) lista = lista.filter((l) => l.setor === opcoes.setor);
    if (opcoes.estagio) lista = lista.filter((l) => l.estagio === opcoes.estagio);

    const recorte = lista.slice(0, Number(opcoes.limite));
    if (opcoes.json) return console.log(JSON.stringify(recorte, null, 2));

    console.log(titulo(`RANKING (${recorte.length} de ${lista.length} leads)`));
    console.log(tabela([
      { chave: 'pos', titulo: '#', direita: true },
      { chave: 'empresa', titulo: 'EMPRESA' },
      { chave: 'tier', titulo: 'TIER' },
      { chave: 'score', titulo: 'SCORE', direita: true },
      { chave: 'fit', titulo: 'FIT', direita: true },
      { chave: 'int', titulo: 'INT', direita: true },
      { chave: 'acs', titulo: 'ACS', direita: true },
      { chave: 'valor', titulo: 'POTENCIAL', direita: true },
      { chave: 'acao', titulo: 'PROXIMA ACAO' },
    ], recorte.map((l) => ({
      pos: String(l.posicao),
      empresa: l.empresa.slice(0, 26),
      tier: COR_TIER[l.tier](l.tier),
      score: l.score.toFixed(1),
      fit: String(l.avaliacao.dimensoes.fit.score),
      int: String(l.avaliacao.dimensoes.intencao.score),
      acs: String(l.avaliacao.dimensoes.acessibilidade.score),
      valor: moeda(l.valorPotencial),
      acao: l.proximaAcao.acao,
    }))));
    console.log(cor.cinza('\nFIT = aderencia ao ICP | INT = intencao | ACS = acessibilidade do decisor'));
  });
}

async function fila(opcoes) {
  await comRepositorio(opcoes, (repositorio) => {
    const lista = carregarPriorizados(repositorio);
    if (!lista) return;

    const doDia = montarFilaDoDia(lista, { capacidade: Number(opcoes.capacidade) })
      .slice(0, Number(opcoes.limite));
    if (opcoes.json) return console.log(JSON.stringify(doDia, null, 2));

    console.log(tabela([
      { chave: 'quando', titulo: 'QUANDO' },
      { chave: 'empresa', titulo: 'EMPRESA' },
      { chave: 'tier', titulo: 'TIER' },
      { chave: 'canal', titulo: 'CANAL' },
      { chave: 'acao', titulo: 'ACAO' },
      { chave: 'porque', titulo: 'POR QUE AGORA' },
    ], doDia.map((l) => ({
      quando: l.proximaAcao.prazoDias === 0 ? cor.vermelho('hoje') : `${l.proximaAcao.prazoDias}d`,
      empresa: l.empresa.slice(0, 24),
      tier: COR_TIER[l.tier](l.tier),
      canal: l.proximaAcao.canal ?? '-',
      acao: l.proximaAcao.acao,
      porque: l.proximaAcao.justificativa.slice(0, 58),
    }))));
    const minutos = doDia.length * 7;
    console.log(cor.cinza(`\n${doDia.length} contatos na fila, cerca de ${Math.round(minutos / 60 * 10) / 10}h de trabalho.`));
  });
}

async function lead(opcoes, id) {
  if (!id) {
    console.error(cor.vermelho('Informe o id: prospecto lead LD-00001'));
    process.exitCode = 1;
    return;
  }

  await comRepositorio(opcoes, (repositorio) => {
    const lista = carregarPriorizados(repositorio);
    if (!lista) return;

    const alvo = lista.find((l) => l.id === id || l.empresa.toLowerCase() === id.toLowerCase());
    if (!alvo) {
      console.error(cor.vermelho(`Lead "${id}" nao encontrado.`));
      process.exitCode = 1;
      return;
    }
    if (opcoes.json) return console.log(JSON.stringify(alvo, null, 2));

    const { avaliacao } = alvo;
    console.log(titulo(`${alvo.empresa} (${alvo.id})`));
    console.log(`${cor.cinza('Setor')}        ${SETOR_POR_ID.get(alvo.setor)?.nome ?? alvo.setor}`);
    console.log(`${cor.cinza('Porte')}        ${alvo.funcionarios} funcionarios | ${moeda(alvo.receitaAnual)} de receita`);
    console.log(`${cor.cinza('Local')}        ${alvo.cidade ?? '-'} (${REGIAO_POR_ID.get(alvo.regiao)?.nome ?? alvo.regiao})`);
    console.log(`${cor.cinza('Stack')}        ${(alvo.tecnologias ?? []).join(', ') || '-'}`);
    console.log(`${cor.cinza('Contato')}      ${alvo.contato?.nome ?? '-'} | ${CARGO_POR_ID.get(alvo.contato?.cargo)?.nome ?? '-'}`);
    console.log(`${cor.cinza('Canais')}       ${['email', 'telefone', 'linkedin'].filter((c) => alvo.contato?.[c]).join(', ') || 'nenhum'}`);
    console.log(`${cor.cinza('Estagio')}      ${alvo.estagio} | ${cor.cinza('Potencial')} ${moeda(alvo.valorPotencial)}`);

    console.log(`\n${cor.negrito('SCORE')} ${COR_TIER[alvo.tier](`${alvo.score} (tier ${alvo.tier})`)}   ${cor.cinza(`posicao ${alvo.posicao} de ${lista.length}`)}`);
    for (const [nome, dados] of Object.entries(avaliacao.dimensoes)) {
      console.log(`  ${nome.padEnd(15)} ${String(dados.score).padStart(5)}  ${barra(dados.score, 100)}  ${cor.cinza(`peso ${Math.round(dados.peso * 100)}%`)}`);
    }

    console.log(`\n${cor.negrito('ADERENCIA AO ICP')}`);
    for (const criterio of avaliacao.dimensoes.fit.criterios) {
      const percentual = Math.round(criterio.aderencia * 100);
      const pinte = percentual >= 70 ? cor.verde : percentual >= 40 ? cor.amarelo : cor.vermelho;
      console.log(`  ${criterio.rotulo.padEnd(20)} ${pinte(String(percentual).padStart(3) + '%')}  ${cor.cinza(criterio.detalhe)}`);
    }

    const sinais = avaliacao.dimensoes.intencao.sinais;
    console.log(`\n${cor.negrito('SINAIS DE INTENCAO')}${sinais.length === 0 ? cor.cinza(' (nenhum)') : ''}`);
    for (const sinal of sinais) {
      console.log(`  ${sinal.rotulo.padEnd(30)} ${cor.cinza(`ha ${sinal.diasAtras}d`)}  frescor ${Math.round(sinal.frescor * 100)}%  ${cor.cinza(`+${sinal.contribuicao}`)}`);
    }

    console.log(`\n${cor.negrito('LEITURA')}`);
    for (const motivo of avaliacao.motivos) {
      const marcador = motivo.tipo === 'risco' || motivo.tipo === 'bloqueio' ? cor.vermelho('!') : cor.verde('+');
      console.log(`  ${marcador} ${motivo.texto}`);
    }

    console.log(`\n${cor.negrito('PROXIMA ACAO')}  ${cor.magenta(alvo.proximaAcao.acao)} via ${alvo.proximaAcao.canal ?? '-'} em ate ${alvo.proximaAcao.prazoDias}d`);
    console.log(`  ${cor.cinza(alvo.proximaAcao.justificativa)}\n`);
  });
}

async function cadencia(opcoes, id) {
  if (!id) {
    console.error(cor.vermelho('Informe o id: prospecto cadencia LD-00001'));
    process.exitCode = 1;
    return;
  }

  await comRepositorio(opcoes, (repositorio) => {
    const lista = carregarPriorizados(repositorio);
    if (!lista) return;

    const alvo = lista.find((l) => l.id === id || l.empresa.toLowerCase() === id.toLowerCase());
    if (!alvo) {
      console.error(cor.vermelho(`Lead "${id}" nao encontrado.`));
      process.exitCode = 1;
      return;
    }

    const sequencia = gerarCadencia(alvo, { remetente: opcoes.remetente, empresaRemetente: opcoes.empresa });
    if (opcoes.json) return console.log(JSON.stringify(sequencia, null, 2));

    console.log(titulo(`CADENCIA - ${sequencia.empresa} (tier ${sequencia.tier})`));
    console.log(`${cor.cinza('Trilha')}   ${cor.negrito(sequencia.trilha.nome)} | tom ${sequencia.trilha.tom}`);
    console.log(`${cor.cinza('Angulo')}   ${sequencia.trilha.angulo}`);
    console.log(`${cor.cinza('Esforco')}  ${sequencia.toques.length} toques em ${sequencia.duracaoDias} dias, ~${sequencia.esforcoTotalMin} min no total`);

    for (const toque of sequencia.toques) {
      console.log(`\n${cor.negrito(`--- Toque ${toque.ordem} | dia ${toque.dia} (${toque.dataPrevista}) | ${toque.canal.toUpperCase()} ---`)}`);
      if (toque.assunto) console.log(`${cor.cinza('Assunto:')} ${cor.negrito(toque.assunto)}\n`);
      console.log(toque.corpo);
    }
    console.log(`\n${cor.cinza('Revise antes de enviar: a cadencia e um rascunho estruturado, nao um envio automatico.')}\n`);
  });
}

async function previsao(opcoes) {
  await comRepositorio(opcoes, (repositorio) => {
    const lista = carregarPriorizados(repositorio);
    if (!lista) return;

    const projecao = projetarPipeline(lista, {
      horizonteDias: Number(opcoes.horizonte),
      meta: Number(opcoes.meta),
    });
    if (opcoes.json) return console.log(JSON.stringify(projecao, null, 2));

    console.log(`${cor.cinza(`Horizonte de ${projecao.horizonteDias} dias | ${projecao.leadsConsiderados} leads considerados`)}\n`);
    console.log(`  ${cor.vermelho('Conservador')}  ${moeda(projecao.cenarios.conservador).padStart(16)}`);
    console.log(`  ${cor.negrito('Base')}         ${cor.negrito(moeda(projecao.cenarios.base).padStart(16))}`);
    console.log(`  ${cor.verde('Otimista')}     ${moeda(projecao.cenarios.otimista).padStart(16)}`);
    console.log(cor.cinza(`  Valor bruto em jogo: ${moeda(projecao.valorBruto)}`));

    console.log(`\n${cor.negrito('POR TIER')}`);
    const maximo = Math.max(...Object.values(projecao.porTier).map((t) => t.ponderado), 1);
    for (const [tier, dados] of Object.entries(projecao.porTier).sort()) {
      console.log(`  ${COR_TIER[tier](tier)}  ${String(dados.leads).padStart(4)} leads  ${moeda(dados.ponderado).padStart(14)}  ${barra(dados.ponderado, maximo, 20)}`);
    }

    if (projecao.meta) {
      const m = projecao.meta;
      const pinte = m.atingeNoBase ? cor.verde : m.atingeNoOtimista ? cor.amarelo : cor.vermelho;
      console.log(`\n${cor.negrito('META')} ${moeda(m.valor)}  |  cobertura ${pinte(`${Math.round(m.cobertura * 100)}%`)}`);
      console.log(`  ${pinte(m.diagnostico)}`);
      if (m.lacuna > 0) {
        console.log(`  Falta ${cor.negrito(moeda(m.lacuna))}, equivalente a ~${cor.negrito(String(m.leadsAdicionaisNecessarios))} leads do mesmo perfil.`);
      }
    }

    console.log(`\n${cor.negrito('MAIORES NEGOCIOS')}`);
    console.log(tabela([
      { chave: 'empresa', titulo: 'EMPRESA' },
      { chave: 'tier', titulo: 'TIER' },
      { chave: 'estagio', titulo: 'ESTAGIO' },
      { chave: 'valor', titulo: 'VALOR', direita: true },
      { chave: 'prob', titulo: 'PROB', direita: true },
      { chave: 'pond', titulo: 'PONDERADO', direita: true },
      { chave: 'data', titulo: 'PREVISAO' },
    ], projecao.topDeals.slice(0, 8).map((d) => ({
      empresa: d.empresa.slice(0, 24),
      tier: COR_TIER[d.tier](d.tier),
      estagio: d.estagio,
      valor: moeda(d.valor),
      prob: `${Math.round(d.probabilidade * 100)}%`,
      pond: moeda(d.valorPonderado),
      data: d.dataPrevista,
    }))));
    console.log('');
  });
}

async function resumo(opcoes) {
  await comRepositorio(opcoes, (repositorio) => {
    const lista = carregarPriorizados(repositorio);
    if (!lista) return;

    const dados = resumirCarteira(lista);
    if (opcoes.json) return console.log(JSON.stringify(dados, null, 2));

    console.log(`${cor.negrito(String(dados.total))} leads | score medio ${cor.negrito(String(dados.scoreMedio))} | potencial total ${cor.negrito(moeda(dados.valorTotal))}`);
    console.log(`${cor.negrito(String(dados.prontosParaAcao))} leads pedem acao em ate 24h\n`);

    console.log(cor.negrito('DISTRIBUICAO POR TIER'));
    for (const [tier, quantidade] of Object.entries(dados.porTier)) {
      console.log(`  ${COR_TIER[tier](tier)}  ${String(quantidade).padStart(4)}  ${barra(quantidade, dados.total, 30)}  ${((quantidade / dados.total) * 100).toFixed(1)}%`);
    }

    console.log(`\n${cor.negrito('FUNIL')}`);
    for (const [estagio, quantidade] of Object.entries(dados.porEstagio)) {
      if (quantidade === 0) continue;
      console.log(`  ${estagio.padEnd(14)} ${String(quantidade).padStart(4)}  ${barra(quantidade, dados.total, 30)}`);
    }
  });
}

async function icp(opcoes) {
  await comRepositorio(opcoes, (repositorio) => {
    const definicao = repositorio.obterIcp();
    if (opcoes.json) return console.log(JSON.stringify(definicao, null, 2));

    console.log(titulo('PERFIL DE CLIENTE IDEAL'));
    console.log(descreverIcp(definicao));
    console.log(`\n${cor.negrito('PESOS DO FIT')}`);
    const somaPesos = Object.values(definicao.pesos).reduce((a, b) => a + b, 0);
    for (const [criterio, peso] of Object.entries(definicao.pesos)) {
      console.log(`  ${criterio.padEnd(14)} ${String(peso).padStart(3)}  ${barra(peso, somaPesos, 24)}`);
    }
    console.log(`\n${cor.negrito('COMPOSICAO DO SCORE')}`);
    for (const [dimensao, peso] of Object.entries(definicao.composicao)) {
      console.log(`  ${dimensao.padEnd(14)} ${String(Math.round(peso * 100)).padStart(3)}%`);
    }
    console.log(`\n${cor.negrito('CORTES DE TIER')}  A >= ${definicao.tiers.A} | B >= ${definicao.tiers.B} | C >= ${definicao.tiers.C} | D abaixo disso`);
    console.log(cor.cinza('\nEdite o ICP pela API (PUT /api/icp) ou pelo painel web; a carteira e repriorizada na hora.\n'));
  });
}

async function exportar(opcoes) {
  await comRepositorio(opcoes, async (repositorio) => {
    let lista = carregarPriorizados(repositorio);
    if (!lista) return;
    if (opcoes.tier) lista = lista.filter((l) => opcoes.tier.split(',').includes(l.tier));

    const csv = escreverCsv(lista.map((l) => ({
      posicao: l.posicao,
      id: l.id,
      empresa: l.empresa,
      dominio: l.dominio,
      setor: l.setor,
      funcionarios: l.funcionarios,
      receita_anual: l.receitaAnual,
      regiao: l.regiao,
      cidade: l.cidade,
      contato: l.contato?.nome,
      cargo: l.contato?.cargo,
      email: l.contato?.email,
      telefone: l.contato?.telefone,
      linkedin: l.contato?.linkedin,
      score: l.score,
      tier: l.tier,
      fit: l.avaliacao.dimensoes.fit.score,
      intencao: l.avaliacao.dimensoes.intencao.score,
      acessibilidade: l.avaliacao.dimensoes.acessibilidade.score,
      urgencia: l.urgencia,
      estagio: l.estagio,
      valor_potencial: l.valorPotencial,
      proxima_acao: l.proximaAcao.acao,
      canal: l.proximaAcao.canal,
      prazo_dias: l.proximaAcao.prazoDias,
      justificativa: l.proximaAcao.justificativa,
    })));

    const destino = opcoes.saida ?? 'prospecto-carteira.csv';
    await writeFile(destino, csv, 'utf8');
    console.log(cor.verde(`${lista.length} leads exportados para ${destino}`));
  });
}

async function servir(opcoes) {
  const porta = Number(opcoes.porta);
  const host = opcoes.host;
  const senha = process.env.PROSPECTO_SENHA || null;
  const modoDemo = process.env.PROSPECTO_MODO_DEMO === '1';

  // Falha antes de abrir o socket: subir exposto e sem senha e pior que nao subir.
  exigirConfiguracaoSegura({ host, senha, modoDemo });

  const repositorio = new Repositorio(opcoes.banco);
  if (repositorio.contarLeads() === 0) {
    console.log(cor.amarelo('Banco vazio: gerando uma carteira de exemplo para o painel nao abrir em branco.'));
    repositorio.salvarLeads(gerarCarteira({ quantidade: Number(opcoes.quantidade), semente: opcoes.semente }));
  }

  const servidor = criarServidor(repositorio, {
    log: process.env.PROSPECTO_LOG !== '0',
    senha,
    modoDemo,
    sementeDemo: opcoes.semente,
    quantidadeDemo: Number(opcoes.quantidade),
    segredoSessao: process.env.PROSPECTO_SEGREDO,
    confiarProxy: process.env.PROSPECTO_ATRAS_DE_PROXY === '1',
    duracaoSessaoHoras: Number(process.env.PROSPECTO_SESSAO_HORAS) || 12,
  });

  servidor.listen(porta, host, () => {
    const endereco = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`\n${cor.negrito('Prospecto')} rodando em ${cor.ciano(`http://${endereco}:${porta}`)}`);
    console.log(cor.cinza(`${repositorio.contarLeads()} leads carregados de ${opcoes.banco}`));
    if (modoDemo) {
      console.log(cor.amarelo('MODO DEMONSTRACAO: acesso aberto, carteira 100% ficticia.'));
      console.log(cor.cinza('Nao use este modo com dados reais de clientes.'));
    } else {
      console.log(senha
        ? cor.verde('Acesso protegido por senha.')
        : cor.amarelo('Sem senha: acessivel so pelo localhost.'));
    }
    if (senha && !process.env.PROSPECTO_SEGREDO) {
      console.log(cor.amarelo('Aviso: PROSPECTO_SEGREDO nao definida; as sessoes cairao a cada reinicio.'));
    }
    console.log(cor.cinza('Ctrl+C para encerrar\n'));
  });

  servidor.on('error', (erro) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(cor.vermelho(`A porta ${porta} ja esta em uso. Use --porta <outra>.`));
      process.exitCode = 1;
      repositorio.fechar();
      return;
    }
    throw erro;
  });

  // Encerramento limpo: o orquestrador manda SIGTERM antes de derrubar o
  // container, e fechar o banco evita deixar arquivo WAL pendurado no volume.
  let encerrando = false;
  const encerrar = () => {
    if (encerrando) return;
    encerrando = true;
    console.log(cor.cinza('\nEncerrando...'));
    servidor.close(() => {
      repositorio.fechar();
      process.exit(0);
    });
    // Rede de seguranca: conexao presa nao pode travar o desligamento.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

principal().catch((erro) => {
  if (erro instanceof ErroDeValidacao) {
    console.error(cor.vermelho(erro.message));
  } else {
    console.error(cor.vermelho(`Erro: ${erro.message}`));
    if (process.env.DEBUG) console.error(erro.stack);
  }
  process.exitCode = 1;
});
