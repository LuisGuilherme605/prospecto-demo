/**
 * Gerador de cadencia de contato.
 *
 * A cadencia nao e um template fixo com o nome trocado. A trilha e escolhida a
 * partir do sinal mais forte do lead: quem abriu vaga de SDR recebe um assunto
 * diferente de quem visitou a pagina de precos. O texto sai pronto para revisao
 * humana -- e o vendedor edita, nao escreve do zero.
 */

import { SETOR_POR_ID, CARGO_POR_ID, porteDeFuncionarios } from '../data/taxonomy.js';
import { formatarBRL } from './scoring.js';
import { valorPotencial } from './priorizacao.js';

/**
 * Trilhas disponiveis, da mais especifica para a mais generica.
 * `gatilho` decide se a trilha se aplica; a primeira que casar e usada.
 */
export const TRILHAS = [
  {
    id: 'pos_precificacao',
    nome: 'Visita a pagina de precos',
    gatilho: (ctx) => ctx.temSinal('visitou_precos', 7) || ctx.temSinal('demo_solicitada', 10),
    tom: 'direto',
    angulo: 'A pessoa ja esta avaliando. Nao vender o problema, resolver a duvida que trava a decisao.',
  },
  {
    id: 'crescimento_time',
    nome: 'Contratacao na area-alvo',
    gatilho: (ctx) => ctx.temSinal('vaga_aberta', 45),
    tom: 'consultivo',
    angulo: 'Contratar significa que a meta cresceu. O custo de nao resolver processo agora e contratar mais gente depois.',
  },
  {
    id: 'novo_capital',
    nome: 'Captacao de investimento',
    gatilho: (ctx) => ctx.temSinal('rodada_investimento', 120),
    tom: 'estrategico',
    angulo: 'Ha orcamento novo e pressao por eficiencia. Falar em velocidade de execucao, nao em economia.',
  },
  {
    id: 'nova_lideranca',
    nome: 'Troca de lideranca',
    gatilho: (ctx) => ctx.temSinal('nova_lideranca', 90),
    tom: 'consultivo',
    angulo: 'Lideranca nova precisa de resultado rapido e visivel nos primeiros 90 dias.',
  },
  {
    id: 'migracao',
    nome: 'Usa solucao concorrente',
    gatilho: (ctx) => ctx.temSinal('usa_concorrente', 200),
    tom: 'comparativo',
    angulo: 'Ja tem ferramenta. O gancho e a lacuna operacional, nao a troca pela troca.',
  },
  {
    id: 'reengajamento',
    nome: 'Reativacao de contato frio',
    gatilho: (ctx) => ctx.diasSemToque !== null && ctx.diasSemToque >= 12,
    tom: 'leve',
    angulo: 'Ja houve conversa. Reabrir com informacao nova, nao com "passando para saber".',
  },
  {
    id: 'fit_estrutural',
    nome: 'Aderencia ao ICP sem sinal quente',
    gatilho: () => true,
    tom: 'direto',
    angulo: 'Sem sinal de intencao: o unico ativo e a relevancia do problema para o segmento.',
  },
];

/** Estrutura de toques por tier: quanto melhor o lead, mais canais e mais toques. */
const ESTRUTURA_POR_TIER = {
  A: [
    { dia: 0, canal: 'email', tipo: 'abertura', personalizacao: 'alta' },
    { dia: 1, canal: 'linkedin', tipo: 'conexao', personalizacao: 'alta' },
    { dia: 3, canal: 'telefone', tipo: 'tentativa', personalizacao: 'media' },
    { dia: 5, canal: 'email', tipo: 'prova', personalizacao: 'alta' },
    { dia: 9, canal: 'telefone', tipo: 'tentativa', personalizacao: 'media' },
    { dia: 13, canal: 'email', tipo: 'encerramento', personalizacao: 'media' },
  ],
  B: [
    { dia: 0, canal: 'email', tipo: 'abertura', personalizacao: 'media' },
    { dia: 3, canal: 'linkedin', tipo: 'conexao', personalizacao: 'media' },
    { dia: 6, canal: 'email', tipo: 'prova', personalizacao: 'media' },
    { dia: 11, canal: 'email', tipo: 'encerramento', personalizacao: 'baixa' },
  ],
  C: [
    { dia: 0, canal: 'email', tipo: 'abertura', personalizacao: 'baixa' },
    { dia: 7, canal: 'email', tipo: 'prova', personalizacao: 'baixa' },
    { dia: 16, canal: 'email', tipo: 'encerramento', personalizacao: 'baixa' },
  ],
  D: [
    { dia: 0, canal: 'email', tipo: 'nutricao', personalizacao: 'baixa' },
  ],
};

/** Assuntos por trilha e tipo de toque. `{{empresa}}` e resolvido no final. */
const ASSUNTOS = {
  pos_precificacao: {
    abertura: 'Duvida sobre o plano certo para a {{empresa}}',
    prova: 'Como {{referencia}} decidiu isso em uma semana',
    encerramento: 'Fecho o assunto, {{primeiroNome}}?',
  },
  crescimento_time: {
    abertura: 'Vi a vaga de {{areaVaga}} na {{empresa}}',
    prova: 'O que muda quando o time de {{areaVaga}} dobra',
    encerramento: 'Ultimo toque sobre a operacao comercial da {{empresa}}',
  },
  novo_capital: {
    abertura: 'Depois da captacao: onde a {{empresa}} costuma travar',
    prova: 'Numeros de {{referencia}} no mesmo estagio',
    encerramento: 'Encerro por aqui, {{primeiroNome}}',
  },
  nova_lideranca: {
    abertura: 'Primeiros 90 dias na {{empresa}}',
    prova: 'Um diagnostico de 20 minutos',
    encerramento: 'Deixo o material e saio do seu radar',
  },
  migracao: {
    abertura: 'O que o {{concorrente}} nao resolve na sua operacao',
    prova: 'Comparativo pratico, sem discurso de venda',
    encerramento: 'Fecho a conversa sobre {{concorrente}}?',
  },
  reengajamento: {
    abertura: 'Retomando: mudou uma coisa desde a nossa conversa',
    prova: 'Resultado novo que vale o seu tempo',
    encerramento: 'Arquivo o assunto, {{primeiroNome}}?',
  },
  fit_estrutural: {
    abertura: 'Operacao comercial da {{empresa}}',
    prova: 'Como empresas de {{setor}} resolvem isso',
    encerramento: 'Encerro o contato, {{primeiroNome}}?',
  },
};

/**
 * Corpo dos e-mails. Sao esqueletos curtos e propositais: e-mail de prospeccao
 * longo nao e lido. Cada bloco tem contexto, evidencia e um unico pedido.
 */
const CORPOS = {
  abertura: [
    'Oi {{primeiroNome}}, tudo bem?',
    '',
    '{{ganchoContexto}}',
    '',
    '{{hipoteseDeDor}}',
    '',
    '{{pedido}}',
    '',
    '{{assinatura}}',
  ],
  prova: [
    'Oi {{primeiroNome}},',
    '',
    '{{provaSocial}}',
    '',
    '{{hipoteseDeDor}}',
    '',
    'Vale 15 minutos para eu mostrar o caminho aplicado a {{empresa}}?',
    '',
    '{{assinatura}}',
  ],
  encerramento: [
    'Oi {{primeiroNome}},',
    '',
    'Escrevi algumas vezes sobre {{temaCentral}} e nao tive retorno, o que normalmente significa uma de tres coisas: nao e prioridade agora, ja esta resolvido, ou nao sou eu quem deveria falar com voce sobre isso.',
    '',
    'Me diz qual das tres e eu ajusto daqui. Se for a terceira, me indica a pessoa certa?',
    '',
    '{{assinatura}}',
  ],
  nutricao: [
    'Oi {{primeiroNome}},',
    '',
    'Separei um material sobre {{temaCentral}} em {{setor}}. Sem pedido nenhum, so achei que era util para a {{empresa}}.',
    '',
    '{{assinatura}}',
  ],
};

/** Roteiros dos toques que nao sao e-mail. */
const ROTEIROS = {
  conexao: [
    'Pedido de conexao no LinkedIn com nota curta (max. 280 caracteres):',
    '',
    '"Oi {{primeiroNome}}, {{ganchoCurto}}. Acompanho o que a {{empresa}} vem fazendo em {{setor}} e queria trocar uma ideia sobre {{temaCentral}}."',
  ],
  tentativa: [
    'Roteiro de ligacao (objetivo: agendar, nao vender)',
    '',
    'Abertura: "Oi {{primeiroNome}}, aqui e {{remetente}}. Peguei voce em um momento ruim?"',
    'Contexto (10s): "{{ganchoCurto}}."',
    'Pergunta de diagnostico: "{{perguntaDiagnostico}}"',
    'Fechamento: "Consigo te mostrar isso em 15 minutos. Quinta as 10h ou sexta as 16h?"',
    '',
    'Se cair na caixa postal: nao deixe recado no primeiro toque. Envie o e-mail do dia seguinte referenciando a ligacao.',
  ],
};

const TEMAS_POR_SETOR = {
  saas: 'previsibilidade de receita recorrente',
  ecommerce: 'recuperacao de carrinho e recompra',
  servicos: 'ocupacao da equipe e margem por projeto',
  industria: 'ciclo de cotacao e follow-up de orcamento',
  saude: 'agenda ociosa e retorno de pacientes',
  educacao: 'captacao e evasao de matriculas',
  financeiro: 'qualificacao e compliance do funil',
  logistica: 'cotacao rapida e retencao de contas',
  construcao: 'follow-up de proposta e ciclo longo',
  agro: 'relacionamento de safra e recompra',
};

const PERGUNTAS = {
  saas: 'Como voces acompanham hoje quais contas estao prestes a churnar?',
  ecommerce: 'Quanto da sua receita hoje vem de cliente recorrente?',
  servicos: 'Quantas propostas ficam sem follow-up depois da primeira semana?',
  industria: 'Quanto tempo leva entre o pedido de cotacao e a proposta na mao do cliente?',
  saude: 'Qual o percentual de horarios ociosos na agenda por semana?',
  educacao: 'Quantos interessados voces perdem entre a inscricao e a matricula?',
  financeiro: 'Quanto do time comercial gasta com lead que nunca ia fechar?',
  logistica: 'Em quanto tempo voces respondem uma cotacao hoje?',
  construcao: 'Como voces mantem o contato vivo num ciclo de 6 meses?',
  agro: 'Como voces organizam o contato fora da janela de safra?',
};

/**
 * Gera a cadencia completa de um lead.
 *
 * @param {object} lead lead ja avaliado (com `avaliacao`), ou lead cru + `avaliacao` em opcoes
 * @param {object} opcoes remetente, empresa remetente, referencia de data e caso de sucesso
 */
export function gerarCadencia(lead, opcoes = {}) {
  const avaliacao = lead.avaliacao ?? opcoes.avaliacao;
  if (!avaliacao) throw new TypeError('gerarCadencia precisa de um lead avaliado');

  const referencia = opcoes.referencia ?? new Date();
  const remetente = opcoes.remetente ?? 'Luis';
  const empresaRemetente = opcoes.empresaRemetente ?? 'nossa equipe';
  const sinais = avaliacao.dimensoes.intencao.sinais;

  const contexto = {
    temSinal: (tipo, dias) => sinais.some((s) => s.tipo === tipo && s.diasAtras <= dias),
    diasSemToque: lead.ultimoContatoEm
      ? Math.floor((referencia.getTime() - new Date(lead.ultimoContatoEm).getTime()) / 86_400_000)
      : null,
  };

  const trilha = TRILHAS.find((t) => t.gatilho(contexto)) ?? TRILHAS[TRILHAS.length - 1];
  const variaveis = montarVariaveis(lead, avaliacao, trilha, { remetente, empresaRemetente, referencia: opcoes.casoDeSucesso });
  const estrutura = ESTRUTURA_POR_TIER[avaliacao.tier] ?? ESTRUTURA_POR_TIER.C;

  const toques = estrutura.map((passo, indice) => {
    const data = new Date(referencia.getTime() + passo.dia * 86_400_000);
    const molde = passo.canal === 'email'
      ? CORPOS[passo.tipo] ?? CORPOS.abertura
      : ROTEIROS[passo.tipo] ?? ROTEIROS.tentativa;

    const assunto = passo.canal === 'email'
      ? preencher(ASSUNTOS[trilha.id]?.[passo.tipo] ?? ASSUNTOS.fit_estrutural[passo.tipo] ?? ASSUNTOS.fit_estrutural.abertura, variaveis)
      : null;

    return {
      ordem: indice + 1,
      dia: passo.dia,
      dataPrevista: data.toISOString().slice(0, 10),
      canal: passo.canal,
      tipo: passo.tipo,
      personalizacao: passo.personalizacao,
      assunto,
      corpo: preencher(molde.join('\n'), variaveis),
      tempoEstimadoMin: passo.canal === 'telefone' ? 6 : passo.personalizacao === 'alta' ? 8 : 3,
    };
  });

  return {
    leadId: lead.id ?? null,
    empresa: lead.empresa,
    tier: avaliacao.tier,
    trilha: { id: trilha.id, nome: trilha.nome, tom: trilha.tom, angulo: trilha.angulo },
    duracaoDias: estrutura[estrutura.length - 1].dia,
    esforcoTotalMin: toques.reduce((soma, t) => soma + t.tempoEstimadoMin, 0),
    toques,
    variaveis,
  };
}

function montarVariaveis(lead, avaliacao, trilha, { remetente, empresaRemetente, referencia }) {
  const setor = SETOR_POR_ID.get(lead.setor);
  const cargo = CARGO_POR_ID.get(lead.contato?.cargo);
  const porte = porteDeFuncionarios(lead.funcionarios);
  const nomeCompleto = lead.contato?.nome ?? 'tudo bem';
  const primeiroNome = nomeCompleto.split(' ')[0];
  const tema = TEMAS_POR_SETOR[lead.setor] ?? 'eficiencia da operacao comercial';
  // O "sinal principal" para fins de texto e o mais recente entre os que
  // disparam a trilha escolhida -- nao o de maior peso bruto, que pode ser um
  // sinal antigo e sem relacao com o angulo da mensagem.
  const sinaisDaTrilha = { pos_precificacao: ['visitou_precos', 'demo_solicitada'], crescimento_time: ['vaga_aberta'], novo_capital: ['rodada_investimento'], nova_lideranca: ['nova_lideranca'], migracao: ['usa_concorrente'] };
  const relevantes = sinaisDaTrilha[trilha.id] ?? [];
  const sinais = avaliacao.dimensoes.intencao.sinais;
  const sinalPrincipal = sinais.filter((s) => relevantes.includes(s.tipo))
    .sort((a, b) => a.diasAtras - b.diasAtras)[0] ?? sinais[0];
  const concorrente = (lead.tecnologias ?? []).find((t) => ['hubspot', 'salesforce', 'pipedrive', 'rd-station'].includes(t)) ?? 'a ferramenta atual';

  const ganchoCurto = montarGanchoCurto(trilha.id, { sinalPrincipal, setor, concorrente, lead });

  return {
    empresa: lead.empresa,
    primeiroNome,
    nomeCompleto,
    cargo: cargo?.nome ?? 'lideranca',
    setor: setor?.nome ?? lead.setor,
    porte: porte.nome,
    funcionarios: String(lead.funcionarios),
    temaCentral: tema,
    concorrente,
    areaVaga: lead.setor === 'saas' ? 'SDR/Vendas' : 'comercial',
    remetente,
    empresaRemetente,
    referencia: referencia ?? `uma empresa de ${setor?.nome ?? 'porte parecido'} do mesmo porte`,
    ganchoCurto,
    ganchoContexto: `${ganchoCurto.charAt(0).toUpperCase()}${ganchoCurto.slice(1)}.`,
    hipoteseDeDor: `Na maioria das empresas de ${setor?.nome ?? lead.setor} com ${lead.funcionarios} pessoas, o gargalo esta em ${tema} -- nao por falta de esforco, mas porque o processo depende de alguem lembrar de fazer o follow-up.`,
    provaSocial: `${referencia ?? `Uma empresa de ${setor?.nome ?? 'porte parecido'} do tamanho da ${lead.empresa}`} estava com ${tema} sem controle. Em oito semanas o time passou a trabalhar so a fila priorizada e o volume de reunioes agendadas subiu sem contratar ninguem.`,
    pedido: 'Faz sentido eu te mandar em duas linhas como isso funcionaria ai? Se nao for prioridade agora, e so me dizer que eu paro.',
    perguntaDiagnostico: PERGUNTAS[lead.setor] ?? 'Como voces priorizam quem contatar primeiro hoje?',
    valorPotencial: formatarBRL(valorPotencial(lead)),
    assinatura: `${remetente}\n${empresaRemetente}`,
  };
}

function montarGanchoCurto(trilhaId, { sinalPrincipal, setor, concorrente, lead }) {
  switch (trilhaId) {
    case 'pos_precificacao':
      // A trilha cobre dois sinais diferentes; o gancho precisa citar o que de
      // fato aconteceu. Dizer "vi que olharam os precos" para quem pediu uma
      // demo queima a credibilidade logo na primeira linha.
      return sinalPrincipal?.tipo === 'demo_solicitada'
        ? 'vi que voces pediram uma demonstracao por aqui'
        : 'vi que voces estiveram olhando nossos planos nos ultimos dias';
    case 'crescimento_time':
      return 'vi que voces abriram vaga na area comercial';
    case 'novo_capital':
      return 'acompanhei a noticia da captacao de voces';
    case 'nova_lideranca':
      return 'vi a mudanca recente na lideranca da area';
    case 'migracao':
      return `vi que voces usam ${concorrente}`;
    case 'reengajamento':
      return 'a gente conversou ha um tempo e mudou uma coisa desde entao';
    default:
      return sinalPrincipal
        ? `notei movimento recente da ${lead.empresa} na frente comercial`
        : `trabalho com empresas de ${setor?.nome ?? 'segmentos parecidos'} no mesmo estagio da ${lead.empresa}`;
  }
}

/** Substitui `{{variavel}}` pelos valores, deixando placeholders desconhecidos visiveis. */
export function preencher(texto, variaveis) {
  return texto.replace(/\{\{(\w+)\}\}/g, (original, chave) =>
    Object.prototype.hasOwnProperty.call(variaveis, chave) ? String(variaveis[chave]) : original);
}
