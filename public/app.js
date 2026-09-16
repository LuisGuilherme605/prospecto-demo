/**
 * Painel do Prospecto.
 *
 * Sem framework e sem etapa de build: o arquivo e servido como esta. A logica se
 * resume a buscar da API, montar DOM e devolver eventos -- toda decisao de
 * negocio (score, tier, proxima acao) ja vem resolvida do servidor, entao o
 * painel nunca recalcula nada por conta propria e nao ha risco de divergir da
 * CLI.
 */

const estado = {
  filtros: { busca: '', tiers: new Set(), setor: '', estagio: '', pagina: 1 },
  ordenar: null,
  direcao: 'desc',
  modoFila: false,
  meta: 1500000,
  leads: [],
  total: 0,
  paginas: 1,
  metadados: null,
};

const $ = (seletor) => document.querySelector(seletor);
const camadas = $('#camadas');

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('pt-BR');
const moeda = (valor) => BRL.format(valor ?? 0);

/** Cria elemento com atributos e filhos, evitando innerHTML com dado da API. */
function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') node.className = valor;
    else if (chave === 'texto') node.textContent = valor;
    else if (chave === 'html') node.innerHTML = valor;
    else if (chave.startsWith('on')) node.addEventListener(chave.slice(2).toLowerCase(), valor);
    else node.setAttribute(chave, valor === true ? '' : String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    node.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: { 'content-type': 'application/json' },
    ...opcoes,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  // Sessao expirada enquanto a aba estava aberta: mandar de volta ao login e
  // preservar a pagina atual, para o usuario voltar exatamente onde estava.
  if (resposta.status === 401) {
    const destino = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login?destino=${destino}`);
    throw new Error('Sessao expirada');
  }

  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = new Error(dados?.erro ?? `Falha na requisicao (${resposta.status})`);
    erro.detalhes = dados?.detalhes;
    throw erro;
  }
  return dados;
}

/* ------------------------------------------------------------------- tema */

const TEMA_SALVO = 'prospecto:tema';

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema ?? '';
  // localStorage pode lancar (janela privada, cookies bloqueados): o tema e uma
  // conveniencia, nao pode derrubar o painel.
  try {
    if (tema) localStorage.setItem(TEMA_SALVO, tema);
    else localStorage.removeItem(TEMA_SALVO);
  } catch { /* preferencia nao persistida; segue com o tema do sistema */ }
}

function alternarTema() {
  const atual = document.documentElement.dataset.tema;
  const doSistema = matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  const efetivo = atual || doSistema;
  aplicarTema(efetivo === 'escuro' ? 'claro' : 'escuro');
}

try {
  const salvo = localStorage.getItem(TEMA_SALVO);
  if (salvo) document.documentElement.dataset.tema = salvo;
} catch { /* sem preferencia salva */ }

/* ------------------------------------------------------------------- toast */

function toast(mensagem, tipo = 'ok') {
  const area = $('#area-toast');
  if (!area) return;
  const icone = tipo === 'ok' ? '✓' : tipo === 'erro' ? '✗' : 'i';
  const item = el('div', { class: `toast toast--${tipo}`, role: 'status' },
    el('span', { class: 'toast-icone', texto: icone }),
    el('span', { texto: mensagem }));
  area.append(item);
  setTimeout(() => {
    item.classList.add('sair');
    item.addEventListener('animationend', () => item.remove(), { once: true });
  }, 2700);
}

/* ------------------------------------------------------------- indicadores */

function renderIndicadores(resumo, previsao) {
  const cartao = (rotulo, valor, nota) => el('article', { class: 'cartao indicador' },
    el('div', { class: 'rotulo', texto: rotulo }),
    el('div', { class: 'valor', texto: valor }),
    el('div', { class: 'nota', texto: nota }));

  const emA = resumo.porTier.A ?? 0;
  const pct = resumo.total > 0 ? Math.round((emA / resumo.total) * 100) : 0;

  $('#indicadores').replaceChildren(
    cartao('Leads na carteira', NUM.format(resumo.total), `${NUM.format(emA)} em tier A (${pct}%)`),
    cartao('Score medio', String(resumo.scoreMedio), `ticket medio ${moeda(resumo.ticketMedio)}`),
    cartao('Acao em ate 24h', NUM.format(resumo.prontosParaAcao), 'leads que nao podem esperar'),
    cartao('Pipeline ponderado', moeda(previsao.cenarios.base), `${previsao.horizonteDias} dias | bruto ${moeda(previsao.valorBruto)}`),
  );
}

/* ----------------------------------------------------------------- graficos */

/**
 * Barras horizontais. `classe` permite a rampa ordinal de tier; sem ela, todas
 * as barras usam o mesmo tom -- um unico conjunto de dados nao precisa de cor
 * para se distinguir de si mesmo.
 */
function renderBarras(alvo, itens, { total, formatar = NUM.format }) {
  const maximo = Math.max(...itens.map((i) => i.valor), 1);
  alvo.replaceChildren(...itens.map((item) => el('div', { class: 'barra-linha' },
    el('span', { class: 'barra-rotulo', texto: item.rotulo }),
    el('div', { class: 'barra-trilho' },
      el('div', {
        class: `barra-preenchida ${item.classe ?? 'tier-b'}`,
        style: `width:${(item.valor / maximo) * 100}%`,
        title: `${item.rotulo}: ${formatar(item.valor)}`,
      })),
    el('span', {
      class: 'barra-valor',
      texto: total ? `${formatar(item.valor)} (${Math.round((item.valor / total) * 100)}%)` : formatar(item.valor),
    }))));
}

function renderTiers(resumo) {
  const classes = { A: 'tier-a', B: 'tier-b', C: 'tier-c', D: 'tier-d' };
  renderBarras($('#gr-tiers'), Object.entries(resumo.porTier).map(([tier, valor]) => ({
    rotulo: `Tier ${tier}`, valor, classe: classes[tier],
  })), { total: resumo.total });
  $('#rotulo-total').textContent = `${NUM.format(resumo.total)} leads`;
}

function renderFunil(resumo) {
  const nomes = {
    novo: 'Novo', contatado: 'Contatado', engajado: 'Engajado',
    reuniao: 'Reuniao', oportunidade: 'Oportunidade', ganho: 'Ganho', perdido: 'Perdido',
  };
  const itens = Object.entries(resumo.porEstagio)
    .filter(([, valor]) => valor > 0)
    .map(([estagio, valor]) => ({ rotulo: nomes[estagio] ?? estagio, valor, classe: 'tier-b' }));
  renderFunilVazio(itens, resumo);
}

function renderFunilVazio(itens, resumo) {
  const alvo = $('#gr-funil');
  if (itens.length === 0) {
    alvo.replaceChildren(el('p', { class: 'vazio', texto: 'Nenhum lead no funil.' }));
    return;
  }
  renderBarras(alvo, itens, { total: resumo.total });
}

/**
 * Previsao como faixa: o cenario base e um marcador dentro do intervalo, nao um
 * numero solto. Mostrar so o base esconderia o tamanho da incerteza, que e
 * exatamente a informacao que muda a decisao do gestor.
 */
function renderPrevisao(previsao) {
  const { conservador, base, otimista } = previsao.cenarios;
  const metaValor = previsao.meta?.valor ?? 0;

  // A escala vai de zero ao maior entre o cenario otimista e a meta. Escalar so
  // do conservador ao otimista deixaria o marcador do cenario base sempre no
  // meio (base = conservador + desvio, por construcao) -- uma barra bonita que
  // nao informa nada. Com zero na origem, a posicao do marcador e a largura do
  // intervalo passam a ter significado, e a meta entra na mesma regua.
  const escala = Math.max(otimista, metaValor, 1);
  const pct = (valor) => (valor / escala) * 100;

  const trilho = el('div', { class: 'faixa-trilho' },
    el('div', {
      class: 'faixa-intervalo',
      style: `left:${pct(conservador)}%;width:${pct(otimista - conservador)}%`,
      title: `Intervalo: ${moeda(conservador)} a ${moeda(otimista)}`,
    }),
    el('div', {
      class: 'faixa-marcador',
      style: `left:calc(${pct(base)}% - 1.5px)`,
      title: `Cenario base: ${moeda(base)}`,
    }));

  if (metaValor > 0) {
    trilho.append(el('div', {
      class: 'faixa-meta',
      'data-rotulo': 'META',
      style: `left:calc(${pct(metaValor)}% - 1px)`,
      title: `Meta: ${moeda(metaValor)}`,
    }));
  }

  const partes = [
    el('div', { class: 'rotulo', texto: 'Cenario base' }),
    el('div', { class: 'faixa-base', texto: moeda(base) }),
    el('div', { class: 'faixa' },
      trilho,
      el('div', { class: 'faixa-extremos' },
        el('span', { texto: `conservador ${moeda(conservador)}` }),
        el('span', { texto: `otimista ${moeda(otimista)}` }))),
  ];

  if (previsao.meta) {
    const m = previsao.meta;
    const nivel = m.atingeNoBase ? 'bom' : m.atingeNoOtimista ? 'atencao' : 'critico';
    const icone = m.atingeNoBase ? 'OK' : m.atingeNoOtimista ? '!' : 'X';
    const detalhe = m.lacuna > 0
      ? ` Falta ${moeda(m.lacuna)}, o equivalente a cerca de ${NUM.format(m.leadsAdicionaisNecessarios)} leads do mesmo perfil.`
      : '';
    partes.push(el('div', { class: `diagnostico diagnostico--${nivel}` },
      el('span', { class: 'diagnostico-icone', texto: icone }),
      el('span', { texto: `Cobertura de ${Math.round(m.cobertura * 100)}% da meta. ${m.diagnostico}.${detalhe}` })));
  }

  $('#pn-previsao').replaceChildren(...partes);
}

/* ------------------------------------------------------------------ tabela */

const NOME_ACAO = {
  ligar_agora: 'Ligar agora',
  abordagem_direta: 'Abordagem direta',
  abordagem_por_gatilho: 'Abordagem por gatilho',
  sequencia_personalizada: 'Sequencia personalizada',
  sequencia_padrao: 'Sequencia padrao',
  reativar: 'Reativar',
  mapear_decisor: 'Mapear decisor',
  nutrir: 'Nutrir',
  monitorar: 'Monitorar',
  descartar: 'Descartar',
  arquivar: 'Arquivar',
};

function renderTabela() {
  const corpo = $('#corpo-tabela');

  if (estado.leads.length === 0) {
    corpo.replaceChildren(el('tr', {},
      el('td', { colspan: '9' },
        el('div', { class: 'vazio', texto: 'Nenhum lead atende a esses filtros.' }))));
    $('#paginacao').replaceChildren();
    return;
  }

  corpo.replaceChildren(...estado.leads.map((lead) => {
    const urgente = lead.proximaAcao.prazoDias === 0;
    const linha = el('tr', {
      tabindex: '0',
      role: 'button',
      'aria-label': `Abrir ${lead.empresa}`,
      onclick: () => abrirLead(lead.id),
      onkeydown: (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); abrirLead(lead.id); }
      },
    },
      el('td', { class: 'num', texto: String(lead.posicao) }),
      el('td', {},
        el('div', { class: 'celula-empresa', texto: lead.empresa }),
        el('div', { class: 'celula-sub', texto: `${lead.cidade ?? ''} | ${NUM.format(lead.funcionarios)} func.` })),
      el('td', {}, el('span', { class: `selo-tier tier-${lead.tier.toLowerCase()}`, texto: lead.tier })),
      el('td', {
        class: 'num',
        title: `Ordenado por score x urgencia = ${lead.scorePrioridade}`,
      },
        el('div', {}, el('strong', { class: `score-tier-${lead.tier.toLowerCase()}`, texto: lead.score.toFixed(1) })),
        el('div', { class: 'celula-urgencia', texto: `urg ${Math.round(lead.urgencia * 100)}%` })),
      el('td', {}, medidorComposicao(lead.dimensoes)),
      el('td', { class: 'col-opcional' },
        el('div', { texto: lead.contato?.nome ?? '-' }),
        el('div', { class: 'celula-sub', texto: lead.contato?.email ?? 'sem e-mail' })),
      el('td', { class: 'col-opcional num', texto: moeda(lead.valorPotencial) }),
      el('td', {}, el('span', { class: 'etiqueta', texto: NOME_ACAO[lead.proximaAcao.acao] ?? lead.proximaAcao.acao })),
      el('td', { class: 'num' },
        el('span', {
          class: `etiqueta ${urgente ? 'etiqueta--urgente' : ''}`,
          texto: urgente ? 'hoje' : `${lead.proximaAcao.prazoDias}d`,
        })));
    return linha;
  }));

  renderPaginacao();
}

/** Tres medidores finos em vez de tres numeros: a forma da composicao e lida de relance. */
function medidorComposicao(dimensoes) {
  const bloco = el('div', { style: 'display:flex;flex-direction:column;gap:3px;min-width:130px' });
  const linhas = [['Fit', dimensoes.fit], ['Int', dimensoes.intencao], ['Acs', dimensoes.acessibilidade]];
  for (const [nome, valor] of linhas) {
    bloco.append(el('div', { class: 'medidor', title: `${nome}: ${valor}` },
      el('span', { class: 'celula-sub', style: 'width:22px', texto: nome }),
      el('div', { class: 'medidor-trilho' },
        el('div', { class: 'medidor-preenchido', style: `width:${valor}%` })),
      el('span', { class: 'medidor-valor', texto: String(Math.round(valor)) })));
  }
  return bloco;
}

function renderPaginacao() {
  const alvo = $('#paginacao');
  if (estado.modoFila || estado.paginas <= 1) return alvo.replaceChildren();

  alvo.replaceChildren(
    el('button', {
      class: 'botao', disabled: estado.filtros.pagina <= 1, texto: 'Anterior',
      onclick: () => { estado.filtros.pagina -= 1; carregarLeads(); },
    }),
    el('span', { texto: `Pagina ${estado.filtros.pagina} de ${estado.paginas}` }),
    el('button', {
      class: 'botao', disabled: estado.filtros.pagina >= estado.paginas, texto: 'Proxima',
      onclick: () => { estado.filtros.pagina += 1; carregarLeads(); },
    }));
}

/* ------------------------------------------------------------------ gaveta */

function fecharCamadas() {
  camadas.replaceChildren();
  document.body.style.overflow = '';
}

function abrirCamada(conteudo) {
  document.body.style.overflow = 'hidden';
  camadas.replaceChildren(
    el('div', { class: 'cobertura', onclick: fecharCamadas }),
    conteudo);
  // Esc fecha: sem isso a gaveta vira uma armadilha no teclado.
  const aoTeclar = (evento) => {
    if (evento.key === 'Escape') { fecharCamadas(); document.removeEventListener('keydown', aoTeclar); }
  };
  document.addEventListener('keydown', aoTeclar);
}

async function abrirLead(id) {
  const corpo = el('div', { class: 'gaveta-corpo' },
    el('p', { class: 'aviso-carregando', texto: 'Carregando...' }));
  const gaveta = el('aside', { class: 'gaveta', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Detalhe do lead' },
    el('div', { class: 'gaveta-cabeca' },
      el('div', {}, el('h2', { texto: 'Lead' })),
      el('button', { class: 'gaveta-fechar', 'aria-label': 'Fechar', texto: '×', onclick: fecharCamadas })),
    corpo);
  abrirCamada(gaveta);

  try {
    const lead = await api(`/api/leads/${encodeURIComponent(id)}`);
    gaveta.querySelector('.gaveta-cabeca div').replaceChildren(
      el('h2', { texto: lead.empresa }),
      el('div', { class: 'celula-sub', texto: `${lead.id} | ${lead.dominio ?? 'sem dominio'} | ${lead.cidade ?? '-'}` }));
    corpo.replaceChildren(...conteudoDoLead(lead));
  } catch (erro) {
    corpo.replaceChildren(el('p', { class: 'vazio', texto: erro.message }));
  }
}

function conteudoDoLead(lead) {
  const { avaliacao } = lead;
  const secoes = [];

  const btnCopiar = (texto) => el('button', {
    class: 'botao-copiar',
    title: 'Copiar',
    'aria-label': `Copiar ${texto}`,
    texto: '⧉',
    onclick: async (ev) => {
      ev.stopPropagation();
      try {
        await navigator.clipboard.writeText(texto);
        toast('Copiado!');
      } catch {
        toast('Nao foi possivel copiar', 'erro');
      }
    },
  });

  secoes.push(el('section', { class: 'secao' },
    el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px' },
      el('span', { class: `selo-tier tier-${lead.tier.toLowerCase()}`, style: 'width:34px;height:34px;font-size:15px', texto: lead.tier }),
      el('div', {},
        el('div', { style: 'font-size:26px;font-weight:650;line-height:1.1', texto: lead.score.toFixed(1) }),
        el('div', { class: 'celula-sub', texto: `posicao ${lead.posicao} da carteira | urgencia ${Math.round(lead.urgencia * 100)}%` }))),
    ...Object.entries(avaliacao.dimensoes).map(([nome, dados]) => el('div', { class: 'criterio' },
      el('span', { class: 'dado-rotulo', texto: nome }),
      el('div', { class: 'medidor-trilho', style: 'height:7px' },
        el('div', { class: 'medidor-preenchido', style: `width:${dados.score}%` })),
      el('span', { class: 'medidor-valor', texto: String(dados.score) })))));

  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: 'Proxima acao' }),
    el('div', { class: 'acao-destaque' },
      el('div', { class: 'acao-nome', texto: `${NOME_ACAO[lead.proximaAcao.acao] ?? lead.proximaAcao.acao}${lead.proximaAcao.canal ? ` via ${lead.proximaAcao.canal}` : ''}` }),
      el('div', { class: 'acao-porque', texto: `${lead.proximaAcao.justificativa}. Prazo: ${lead.proximaAcao.prazoDias === 0 ? 'hoje' : `${lead.proximaAcao.prazoDias} dias`}.` }))));

  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: 'Leitura do lead' }),
    el('ul', { class: 'lista-motivos' }, ...avaliacao.motivos.map((motivo) => {
      const estilo = { fit: 'positivo', intencao: 'positivo', acao: 'positivo', risco: 'risco', bloqueio: 'bloqueio' }[motivo.tipo] ?? 'neutro';
      const icone = { positivo: '+', risco: '!', bloqueio: 'X', neutro: '.' }[estilo];
      return el('li', { class: `motivo motivo--${estilo}` },
        el('span', { class: 'motivo-icone', texto: icone }),
        el('span', { texto: motivo.texto }));
    }))));

  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: 'Aderencia ao ICP' }),
    ...avaliacao.dimensoes.fit.criterios.flatMap((criterio) => [
      el('div', { class: 'criterio' },
        el('span', { class: 'dado-rotulo', texto: criterio.rotulo }),
        el('div', { class: 'medidor-trilho', style: 'height:7px' },
          el('div', { class: 'medidor-preenchido', style: `width:${criterio.aderencia * 100}%` })),
        el('span', { class: 'medidor-valor', texto: `${Math.round(criterio.aderencia * 100)}%` })),
      el('div', { class: 'criterio-detalhe', texto: criterio.detalhe }),
    ])));

  const sinais = avaliacao.dimensoes.intencao.sinais;
  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: `Sinais de intencao (${sinais.length})` }),
    sinais.length === 0
      ? el('p', { class: 'celula-sub', texto: 'Nenhum sinal registrado: a abordagem sera fria.' })
      : el('div', {}, ...sinais.map((sinal) => el('div', { class: 'sinal' },
        el('span', { class: 'sinal-nome', texto: sinal.rotulo }),
        el('span', { class: 'sinal-quando', texto: sinal.diasAtras === 0 ? 'hoje' : `ha ${sinal.diasAtras}d` }),
        el('span', { class: 'sinal-frescor', title: 'peso restante apos o decaimento temporal', texto: `${Math.round(sinal.frescor * 100)}%` }))))));

  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: 'Empresa e contato' }),
    el('div', { class: 'dados' },
      ...[
        ['Setor', nomeDeMeta('setores', lead.setor)],
        ['Regiao', nomeDeMeta('regioes', lead.regiao)],
        ['Funcionarios', NUM.format(lead.funcionarios)],
        ['Receita anual', moeda(lead.receitaAnual)],
        ['Maturidade digital', `${lead.maturidadeDigital}/5`],
        ['Estagio', lead.estagio],
        ['Contato', lead.contato?.nome ?? '-', null],
        ['Cargo', nomeDeMeta('cargos', lead.contato?.cargo), null],
        ['E-mail', lead.contato?.email ?? '-', lead.contato?.email],
        ['Telefone', lead.contato?.telefone ?? '-', lead.contato?.telefone],
        ['Stack', (lead.tecnologias ?? []).join(', ') || '-', null],
        ['Potencial anual', moeda(lead.valorPotencial), null],
      ].map(([rotulo, valor, copiavel]) => el('div', {},
        el('div', { class: 'dado-rotulo', texto: rotulo }),
        copiavel
          ? el('div', { class: 'dado-valor' }, valor, btnCopiar(copiavel))
          : el('div', { class: 'dado-valor', texto: valor }))))));

  const areaCadencia = el('div', {});
  secoes.push(el('section', { class: 'secao' },
    el('span', { class: 'rotulo', texto: 'Cadencia de contato' }),
    el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap' },
      el('input', { class: 'campo', id: 'in-remetente', placeholder: 'Seu nome', value: 'Luis Guilherme', style: 'flex:1 1 150px' }),
      el('button', {
        class: 'botao botao--primario',
        texto: 'Gerar cadencia',
        onclick: async (evento) => {
          const botao = evento.currentTarget;
          botao.disabled = true;
          botao.textContent = 'Gerando...';
          try {
            const sequencia = await api(`/api/leads/${encodeURIComponent(lead.id)}/cadencia`, {
              method: 'POST',
              corpo: { remetente: $('#in-remetente')?.value || 'Luis Guilherme' },
            });
            areaCadencia.replaceChildren(...renderCadencia(sequencia));
          } catch (erro) {
            areaCadencia.replaceChildren(el('p', { class: 'erro-validacao', texto: erro.message }));
          } finally {
            botao.disabled = false;
            botao.textContent = 'Gerar novamente';
          }
        },
      })),
    areaCadencia));

  return secoes;
}

function renderCadencia(sequencia) {
  return [
    el('div', { class: 'aviso-trilha' },
      el('div', {}, el('strong', { texto: sequencia.trilha.nome }), ` | tom ${sequencia.trilha.tom} | ${sequencia.toques.length} toques em ${sequencia.duracaoDias} dias`),
      el('div', { style: 'margin-top:5px;color:var(--texto-2)', texto: sequencia.trilha.angulo })),
    ...sequencia.toques.map((toque) => el('div', { class: 'toque' },
      el('div', { class: 'toque-cabeca' },
        el('span', { class: 'toque-ordem', texto: String(toque.ordem) }),
        el('span', { class: 'toque-canal', texto: toque.canal }),
        el('span', { class: 'toque-quando', texto: `dia ${toque.dia} | ${toque.dataPrevista}` })),
      toque.assunto ? el('div', { class: 'toque-assunto', texto: toque.assunto }) : null,
      el('pre', { class: 'toque-corpo', texto: toque.corpo }))),
    el('p', { class: 'celula-sub', texto: 'Rascunho estruturado para revisao humana: leia e ajuste antes de enviar.' }),
  ];
}

function nomeDeMeta(colecao, id) {
  const item = estado.metadados?.[colecao]?.find((i) => i.id === id);
  return item?.nome ?? id ?? '-';
}

/* -------------------------------------------------------------- editor ICP */

async function abrirEditorIcp() {
  const icp = await api('/api/icp');
  const rascunho = structuredClone(icp);
  const areaErro = el('div', {});

  const controleDeslizante = (rotulo, obter, definir, { min = 0, max = 100, passo = 1, sufixo = '' } = {}) => {
    const saida = el('output', { texto: `${obter()}${sufixo}` });
    return el('div', { class: 'controle' },
      el('label', { texto: rotulo }),
      el('input', {
        type: 'range', min, max, step: passo, value: obter(),
        oninput: (evento) => {
          const valor = Number(evento.target.value);
          definir(valor);
          saida.textContent = `${valor}${sufixo}`;
        },
      }),
      saida);
  };

  const corpo = el('div', { class: 'modal-corpo' },
    el('p', { class: 'celula-sub', style: 'margin-top:0', texto: 'Mudar o ICP repriorizr a carteira inteira na hora. Os pesos do fit sao relativos entre si; a composicao precisa somar 100%.' }),

    el('section', { class: 'secao' },
      el('span', { class: 'rotulo', texto: 'Pesos dos criterios de fit' }),
      ...Object.keys(rascunho.pesos).map((criterio) => controleDeslizante(
        criterio,
        () => rascunho.pesos[criterio],
        (valor) => { rascunho.pesos[criterio] = valor; },
        { min: 0, max: 40 }))),

    el('section', { class: 'secao' },
      el('span', { class: 'rotulo', texto: 'Composicao do score' }),
      ...['fit', 'intencao', 'acessibilidade'].map((dimensao) => controleDeslizante(
        dimensao,
        () => Math.round(rascunho.composicao[dimensao] * 100),
        (valor) => { rascunho.composicao[dimensao] = valor / 100; },
        { min: 0, max: 100, sufixo: '%' }))),

    el('section', { class: 'secao' },
      el('span', { class: 'rotulo', texto: 'Cortes de tier' }),
      ...['A', 'B', 'C'].map((tier) => controleDeslizante(
        `tier ${tier} a partir de`,
        () => rascunho.tiers[tier],
        (valor) => { rascunho.tiers[tier] = valor; },
        { min: 10, max: 95 }))),

    el('section', { class: 'secao' },
      el('span', { class: 'rotulo', texto: 'Faixa ideal de funcionarios' }),
      controleDeslizante('minimo', () => rascunho.funcionariosIdeal.min,
        (valor) => { rascunho.funcionariosIdeal.min = valor; }, { min: 1, max: 500, passo: 5 }),
      controleDeslizante('maximo', () => rascunho.funcionariosIdeal.max,
        (valor) => { rascunho.funcionariosIdeal.max = valor; }, { min: 10, max: 3000, passo: 10 })),

    areaErro);

  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editar ICP' },
    el('div', { class: 'cartao-cabeca' },
      el('h2', { texto: 'Perfil de Cliente Ideal' }),
      el('button', { class: 'gaveta-fechar', 'aria-label': 'Fechar', texto: '×', onclick: fecharCamadas })),
    corpo,
    el('div', { class: 'modal-rodape' },
      el('button', { class: 'botao', texto: 'Cancelar', onclick: fecharCamadas }),
      el('button', {
        class: 'botao botao--primario',
        texto: 'Salvar e repriorizar',
        onclick: async (evento) => {
          const botao = evento.currentTarget;
          botao.disabled = true;
          try {
            await api('/api/icp', { method: 'PUT', corpo: rascunho });
            fecharCamadas();
            toast('ICP atualizado — carteira repriorizada', 'ok');
            await carregarTudo();
          } catch (erro) {
            const detalhes = Array.isArray(erro.detalhes) ? erro.detalhes.join('; ') : '';
            areaErro.replaceChildren(el('div', { class: 'erro-validacao', texto: detalhes || erro.message }));
            botao.disabled = false;
          }
        },
      })));

  abrirCamada(modal);
}

/* ------------------------------------------------------------ carregamento */

function parametrosDeFiltro() {
  const parametros = new URLSearchParams();
  if (estado.filtros.busca) parametros.set('busca', estado.filtros.busca);
  if (estado.filtros.tiers.size > 0) parametros.set('tier', [...estado.filtros.tiers].join(','));
  if (estado.filtros.setor) parametros.set('setor', estado.filtros.setor);
  if (estado.filtros.estagio) parametros.set('estagio', estado.filtros.estagio);
  if (estado.ordenar) {
    parametros.set('ordenar', estado.ordenar);
    parametros.set('direcao', estado.direcao);
  }
  parametros.set('pagina', String(estado.filtros.pagina));
  parametros.set('porPagina', '50');
  return parametros;
}

let _ctrlBusca = null;

async function carregarLeads() {
  _ctrlBusca?.abort();
  _ctrlBusca = new AbortController();
  const { signal } = _ctrlBusca;

  try {
    if (estado.modoFila) {
      const fila = await api('/api/fila?capacidade=30', { signal });
      estado.leads = fila;
      estado.total = fila.length;
      estado.paginas = 1;
      $('#contagem').textContent = `${fila.length} contatos na fila de hoje`;
    } else {
      const pagina = await api(`/api/leads?${parametrosDeFiltro()}`, { signal });
      estado.leads = pagina.itens;
      estado.total = pagina.total;
      estado.paginas = pagina.paginas;
      $('#contagem').textContent = `${NUM.format(pagina.total)} leads`;
    }
    renderTabela();
  } catch (erro) {
    if (erro.name === 'AbortError') return;
    $('#corpo-tabela').replaceChildren(el('tr', {},
      el('td', { colspan: '9' }, el('div', { class: 'vazio', texto: erro.message }))));
  }
}

async function carregarPaineis() {
  const [resumo, previsao] = await Promise.all([
    api('/api/resumo'),
    api(`/api/previsao?meta=${estado.meta}`),
  ]);
  renderIndicadores(resumo, previsao);
  renderTiers(resumo);
  renderFunil(resumo);
  renderPrevisao(previsao);
}

async function carregarTudo() {
  await Promise.all([carregarPaineis(), carregarLeads()]);
}

function preencherSelects() {
  const setor = $('#f-setor');
  for (const item of estado.metadados.setores) setor.append(el('option', { value: item.id, texto: item.nome }));

  const estagio = $('#f-estagio');
  for (const item of estado.metadados.estagios) estagio.append(el('option', { value: item, texto: item }));
}

/** Espera o usuario parar de digitar antes de consultar a API. */
function comAtraso(funcao, atraso = 260) {
  let temporizador;
  return (...argumentos) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcao(...argumentos), atraso);
  };
}

/* Direcao padrao por coluna ao clicar pela primeira vez */
const DIR_PADRAO = { empresa: 'asc', score: 'desc', tier: 'asc', valor: 'desc', prazo: 'asc', acao: 'asc' };

function atualizarIndicadoresOrdem() {
  for (const th of document.querySelectorAll('.col-ordenavel')) {
    const col = th.dataset.col;
    const seta = th.querySelector('.seta-ordem');
    if (estado.ordenar === col) {
      th.dataset.dir = estado.direcao;
      if (seta) seta.textContent = estado.direcao === 'asc' ? '▲' : '▼';
    } else {
      delete th.dataset.dir;
      if (seta) seta.textContent = '⬍';
    }
  }
}

function clicarColunaOrdem(col) {
  if (estado.ordenar === col) {
    estado.direcao = estado.direcao === 'asc' ? 'desc' : 'asc';
  } else {
    estado.ordenar = col;
    estado.direcao = DIR_PADRAO[col] ?? 'asc';
  }
  estado.filtros.pagina = 1;
  atualizarIndicadoresOrdem();
  carregarLeads();
}

/**
 * Faixa de demonstracao.
 *
 * Numa demo publica o visitante precisa saber, sem precisar perguntar, que os
 * dados nao sao de empresas reais -- e precisa de um jeito de desfazer o que
 * mexeu, para nao estragar a demonstracao de quem vier depois.
 */
async function configurarModoDemo() {
  const modo = await api('/api/modo').catch(() => ({ demo: false }));
  if (!modo.demo) return;

  const botaoRestaurar = el('button', {
    class: 'botao botao--claro',
    texto: 'Restaurar demonstracao',
    onclick: async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      botao.textContent = 'Restaurando...';
      try {
        await api('/api/demo/restaurar', { method: 'POST' });
        estado.filtros.pagina = 1;
        await carregarTudo();
      } finally {
        botao.disabled = false;
        botao.textContent = 'Restaurar demonstracao';
      }
    },
  });

  document.body.prepend(el('div', { class: 'faixa-demo', role: 'status' },
    el('strong', { texto: 'Demonstracao' }),
    el('span', { texto: 'Todos os leads, contatos e telefones desta tela sao ficticios, gerados por algoritmo. Nenhuma empresa ou pessoa real aparece aqui.' }),
    botaoRestaurar));
  document.body.classList.add('com-faixa-demo');
}

/** O botao de sair so faz sentido quando ha sessao para encerrar. */
async function configurarSaida() {
  try {
    const sessao = await api('/api/sessao');
    if (!sessao.protecaoAtiva) return;

    $('#topo-acoes').prepend(el('button', {
      class: 'botao',
      texto: 'Sair',
      onclick: async () => {
        await fetch('/api/sessao', { method: 'DELETE' });
        location.replace('/login');
      },
    }));
  } catch { /* sem protecao configurada: nada a fazer */ }
}

function ligarEventos() {
  $('#btn-tema').addEventListener('click', alternarTema);
  $('#btn-icp').addEventListener('click', () => abrirEditorIcp().catch((erro) => alert(erro.message)));
  $('#btn-exportar').addEventListener('click', () => {
    const tier = estado.filtros.tiers.size > 0 ? `?tier=${[...estado.filtros.tiers].join(',')}` : '';
    window.location.href = `/api/exportar.csv${tier}`;
    toast('Exportacao iniciada', 'info');
  });

  // Pressionar "/" foca a busca, igual ao GitHub e outros paineis.
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== '/') return;
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    const alvo = evento.target;
    if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable) return;
    evento.preventDefault();
    const busca = $('#f-busca');
    busca?.focus();
    busca?.select();
  });

  for (const th of document.querySelectorAll('.col-ordenavel')) {
    th.addEventListener('click', () => clicarColunaOrdem(th.dataset.col));
  }

  $('#btn-fila').addEventListener('click', (evento) => {
    estado.modoFila = !estado.modoFila;
    evento.currentTarget.classList.toggle('botao--primario', estado.modoFila);
    evento.currentTarget.textContent = estado.modoFila ? 'Ver carteira' : 'Fila de hoje';
    carregarLeads();
  });

  $('#f-busca').addEventListener('input', comAtraso((evento) => {
    estado.filtros.busca = evento.target.value.trim();
    estado.filtros.pagina = 1;
    carregarLeads();
  }));

  for (const campo of ['setor', 'estagio']) {
    $(`#f-${campo}`).addEventListener('change', (evento) => {
      estado.filtros[campo] = evento.target.value;
      estado.filtros.pagina = 1;
      carregarLeads();
    });
  }

  for (const pilula of document.querySelectorAll('.pilula-tier')) {
    pilula.addEventListener('click', () => {
      const tier = pilula.dataset.tier;
      if (estado.filtros.tiers.has(tier)) estado.filtros.tiers.delete(tier);
      else estado.filtros.tiers.add(tier);
      pilula.setAttribute('aria-pressed', String(estado.filtros.tiers.has(tier)));
      estado.filtros.pagina = 1;
      carregarLeads();
    });
  }

  $('#in-meta').addEventListener('input', comAtraso(async (evento) => {
    estado.meta = Math.max(0, Number(evento.target.value) || 0);
    const previsao = await api(`/api/previsao?meta=${estado.meta}`);
    renderPrevisao(previsao);
  }, 380));
}

async function iniciar() {
  try {
    estado.metadados = await api('/api/meta');
    preencherSelects();
    ligarEventos();
    await Promise.all([carregarTudo(), configurarSaida(), configurarModoDemo()]);
  } catch (erro) {
    document.querySelector('main').replaceChildren(
      el('div', { class: 'cartao' },
        el('div', { class: 'vazio' },
          el('p', { texto: `Nao foi possivel carregar os dados: ${erro.message}` }),
          el('p', { class: 'celula-sub', texto: 'Verifique se o servidor esta rodando com "npm start".' }))));
  }
}

iniciar();
