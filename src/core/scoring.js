/**
 * Motor de scoring explicavel.
 *
 * Regra de ouro deste modulo: nenhum numero sai daqui sem a razao dele junto.
 * Um vendedor que recebe "score 84" nao muda de comportamento; um vendedor que
 * recebe "84 porque usa RD Station, abriu vaga de SDR ha 6 dias e o contato e o
 * Head de Vendas" sabe exatamente como abrir a conversa.
 *
 * O score final tem tres dimensoes independentes:
 *   fit           - o quanto a empresa parece com o ICP (estrutural, muda devagar)
 *   intencao      - o quanto ela esta se mexendo agora (volatil, decai com o tempo)
 *   acessibilidade- o quanto da para falar com quem decide (operacional)
 */

import { SETOR_POR_ID, PORTE_POR_ID, REGIAO_POR_ID, CARGO_POR_ID, SINAL_POR_ID, porteDeFuncionarios } from '../data/taxonomy.js';

const DIA_MS = 86_400_000;

const limitar = (valor, min = 0, max = 100) => Math.min(max, Math.max(min, valor));
const arredondar = (valor, casas = 1) => Number(valor.toFixed(casas));

/**
 * Proximidade de um valor a uma faixa ideal, em [0, 1].
 *
 * Dentro da faixa vale 1. Fora, cai suavemente em vez de zerar: uma empresa com
 * 320 funcionarios quando o ideal e 30-300 nao deixa de ser boa de uma hora
 * para outra.
 *
 * A queda e medida por RAZAO, nao por diferenca absoluta. Porte e receita sao
 * grandezas multiplicativas: uma empresa de 10 pessoas nao esta "20 unidades"
 * abaixo de um ICP de 30-300, ela e tres vezes menor -- e uma medida absoluta
 * sobre a amplitude da faixa daria a ela 88% de aderencia, o que e simplesmente
 * falso. Pela razao, 10/30 da 33%, que e o que um vendedor diria olhando.
 * A curva tambem e continua na borda (valor = min da exatamente 1) e nao
 * depende da unidade, entao serve para funcionarios e para reais sem calibrar
 * duas vezes.
 *
 * @param {number} dureza expoente da queda; acima de 1 pune mais quem esta fora
 */
export function proximidadeDeFaixa(valor, { min, max }, dureza = 1) {
  if (valor >= min && valor <= max) return 1;

  if (valor < min) {
    // Faixas ancoradas em zero nao tem razao definida: cai para a medida
    // absoluta sobre a amplitude.
    if (min <= 0) {
      const amplitude = Math.max(max - min, 1);
      return limitar(1 - (min - valor) / amplitude, 0, 1);
    }
    return limitar((Math.max(valor, 0) / min) ** dureza, 0, 1);
  }

  if (max <= 0) return 0;
  return limitar((max / valor) ** dureza, 0, 1);
}

/**
 * Peso remanescente de um sinal apos `dias`, por decaimento exponencial.
 * Na meia-vida o sinal vale metade; em 3 meias-vidas, um oitavo.
 */
export function decaimento(dias, meiaVidaDias) {
  if (dias <= 0) return 1;
  if (meiaVidaDias <= 0) return 0;
  return 2 ** (-dias / meiaVidaDias);
}

/** Dias corridos entre duas datas (nunca negativo). */
function diasDesde(data, referencia) {
  return Math.max(0, (referencia.getTime() - new Date(data).getTime()) / DIA_MS);
}

/**
 * Score estrutural de aderencia ao ICP (0-100) com a contribuicao de cada criterio.
 */
export function calcularFit(lead, icp) {
  const { pesos } = icp;
  const criterios = [];

  const registrar = (id, rotulo, aderencia, detalhe) => {
    const peso = pesos[id] ?? 0;
    criterios.push({
      id,
      rotulo,
      aderencia: arredondar(aderencia, 3),
      peso,
      contribuicao: arredondar(aderencia * peso, 2),
      detalhe,
    });
  };

  const setor = SETOR_POR_ID.get(lead.setor);
  const setorNoAlvo = icp.setoresAlvo.includes(lead.setor);
  registrar('setor', 'Setor', setorNoAlvo ? 1 : 0.15,
    setorNoAlvo ? `${setor?.nome ?? lead.setor} esta no ICP` : `${setor?.nome ?? lead.setor} fora do ICP`);

  const aderenciaPorte = proximidadeDeFaixa(lead.funcionarios, icp.funcionariosIdeal);
  const porte = porteDeFuncionarios(lead.funcionarios);
  registrar('porte', 'Porte', aderenciaPorte,
    `${lead.funcionarios} funcionarios (${porte.nome}), ideal ${icp.funcionariosIdeal.min}-${icp.funcionariosIdeal.max}`);

  const aderenciaReceita = proximidadeDeFaixa(lead.receitaAnual, icp.receitaAnualIdeal);
  registrar('receita', 'Receita', aderenciaReceita,
    `${formatarBRL(lead.receitaAnual)} de receita anual estimada`);

  const regiaoNoAlvo = icp.regioesAlvo.includes(lead.regiao);
  const regiao = REGIAO_POR_ID.get(lead.regiao);
  registrar('regiao', 'Regiao', regiaoNoAlvo ? 1 : 0.3,
    `${regiao?.nome ?? lead.regiao}${regiaoNoAlvo ? '' : ' (fora das regioes prioritarias)'}`);

  const stack = lead.tecnologias ?? [];
  const compativeis = stack.filter((t) => icp.tecnologiasAlvo.includes(t));
  const bloqueadas = stack.filter((t) => (icp.tecnologiasBloqueio ?? []).includes(t));
  // Saturacao: a segunda tecnologia compativel confirma o sinal, a quinta nao
  // acrescenta quase nada. Sem isso, uma empresa que usa tudo domina o ranking.
  const aderenciaStack = bloqueadas.length > 0 ? 0 : limitar(1 - 0.55 ** compativeis.length, 0, 1);
  registrar('tecnologia', 'Stack', aderenciaStack,
    bloqueadas.length > 0
      ? `bloqueado por usar ${bloqueadas.join(', ')}`
      : compativeis.length > 0
        ? `usa ${compativeis.join(', ')}`
        : 'nenhuma tecnologia compativel identificada');

  const maturidade = lead.maturidadeDigital ?? 0;
  const aderenciaMaturidade = maturidade >= icp.maturidadeDigitalMinima
    ? limitar((maturidade - icp.maturidadeDigitalMinima) / Math.max(5 - icp.maturidadeDigitalMinima, 1) * 0.4 + 0.6, 0, 1)
    : limitar(maturidade / Math.max(icp.maturidadeDigitalMinima, 1) * 0.6, 0, 1);
  registrar('maturidade', 'Maturidade digital', aderenciaMaturidade,
    `nivel ${maturidade}/5 (minimo do ICP: ${icp.maturidadeDigitalMinima})`);

  const pesoTotal = criterios.reduce((soma, c) => soma + c.peso, 0);
  const bruto = criterios.reduce((soma, c) => soma + c.contribuicao, 0);
  const score = pesoTotal > 0 ? limitar((bruto / pesoTotal) * 100) : 0;

  return {
    score: arredondar(score),
    criterios: criterios.sort((a, b) => b.contribuicao - a.contribuicao),
    bloqueado: bloqueadas.length > 0,
  };
}

/**
 * Score de intencao (0-100) a partir dos sinais, ja com decaimento temporal.
 *
 * A soma e saturada por uma curva de rendimento decrescente: dez aberturas de
 * e-mail nao valem mais que uma resposta. `referencia` permite congelar o "hoje"
 * nos testes.
 */
export function calcularIntencao(lead, referencia = new Date()) {
  const sinais = (lead.sinais ?? [])
    .map((registro) => {
      const meta = SINAL_POR_ID.get(registro.tipo);
      if (!meta) return null;
      const dias = diasDesde(registro.data, referencia);
      const fator = decaimento(dias, meta.meiaVidaDias);
      const intensidade = registro.intensidade ?? 1;
      return {
        tipo: registro.tipo,
        rotulo: meta.nome,
        categoria: meta.categoria,
        data: registro.data,
        diasAtras: Math.round(dias),
        pesoBase: meta.peso,
        frescor: arredondar(fator, 3),
        contribuicao: arredondar(meta.peso * fator * intensidade, 2),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.contribuicao - a.contribuicao);

  // Curva de saturacao: 180 pontos brutos ~ 63 de score, 400 ~ 89.
  const bruto = sinais.reduce((soma, s) => soma + s.contribuicao, 0);
  const score = limitar(100 * (1 - Math.exp(-bruto / 180)));

  const categorias = {};
  for (const sinal of sinais) {
    categorias[sinal.categoria] = arredondar((categorias[sinal.categoria] ?? 0) + sinal.contribuicao, 2);
  }

  return { score: arredondar(score), bruto: arredondar(bruto), sinais, categorias };
}

/**
 * Score de acessibilidade (0-100): da para falar com quem decide, e por qual canal.
 */
export function calcularAcessibilidade(lead, icp) {
  const cargo = CARGO_POR_ID.get(lead.contato?.cargo);
  const noAlvo = icp.cargosAlvo.includes(lead.contato?.cargo);
  const poder = (cargo?.poder ?? 0.2) * (noAlvo ? 1 : 0.7);
  const alcance = cargo?.alcance ?? 0.5;

  const canais = {
    email: Boolean(lead.contato?.email),
    telefone: Boolean(lead.contato?.telefone),
    linkedin: Boolean(lead.contato?.linkedin),
  };
  const canaisAtivos = Object.values(canais).filter(Boolean).length;
  const cobertura = canaisAtivos / 3;

  // Poder sem alcance vira frustracao; alcance sem poder vira reuniao inutil.
  // A media geometrica penaliza quem e fraco em qualquer um dos dois.
  const qualidadeContato = Math.sqrt(poder * alcance);
  const score = limitar((qualidadeContato * 0.65 + cobertura * 0.35) * 100);

  return {
    score: arredondar(score),
    cargo: cargo?.nome ?? 'Cargo nao identificado',
    nivel: cargo?.nivel ?? 'desconhecido',
    cargoNoAlvo: noAlvo,
    poder: arredondar(poder, 2),
    alcance: arredondar(alcance, 2),
    canais,
    canaisAtivos,
  };
}

/** Classifica o score final em tier A/B/C/D. */
export function classificarTier(score, tiers) {
  if (score >= tiers.A) return 'A';
  if (score >= tiers.B) return 'B';
  if (score >= tiers.C) return 'C';
  return 'D';
}

/**
 * Avaliacao completa de um lead: score final, tier, breakdown e justificativa
 * em linguagem natural.
 */
export function avaliarLead(lead, icp, referencia = new Date()) {
  const fit = calcularFit(lead, icp);
  const intencao = calcularIntencao(lead, referencia);
  const acessibilidade = calcularAcessibilidade(lead, icp);
  const { composicao } = icp;

  let score = fit.score * composicao.fit
    + intencao.score * composicao.intencao
    + acessibilidade.score * composicao.acessibilidade;

  // Tecnologia de bloqueio e criterio eliminatorio, nao um desconto: um lead
  // desqualificado nao pode subir no ranking por ter muita intencao.
  if (fit.bloqueado) score = Math.min(score, 25);

  const finalScore = arredondar(limitar(score));
  const tier = classificarTier(finalScore, icp.tiers);

  return {
    score: finalScore,
    tier,
    bloqueado: fit.bloqueado,
    dimensoes: {
      fit: { score: fit.score, peso: composicao.fit, criterios: fit.criterios },
      intencao: { score: intencao.score, peso: composicao.intencao, bruto: intencao.bruto, sinais: intencao.sinais, categorias: intencao.categorias },
      acessibilidade: { score: acessibilidade.score, peso: composicao.acessibilidade, ...acessibilidade },
    },
    motivos: montarMotivos(fit, intencao, acessibilidade, tier),
    avaliadoEm: referencia.toISOString(),
  };
}

/** Traduz o breakdown numerico em frases acionaveis para o vendedor. */
function montarMotivos(fit, intencao, acessibilidade, tier) {
  const motivos = [];

  if (fit.bloqueado) {
    const criterio = fit.criterios.find((c) => c.id === 'tecnologia');
    motivos.push({ tipo: 'bloqueio', texto: `Desqualificado: ${criterio?.detalhe ?? 'criterio de bloqueio do ICP'}` });
    return motivos;
  }

  for (const criterio of fit.criterios.slice(0, 2)) {
    if (criterio.aderencia >= 0.7) {
      motivos.push({ tipo: 'fit', texto: `${criterio.rotulo}: ${criterio.detalhe}` });
    }
  }

  const fraco = fit.criterios.filter((c) => c.aderencia < 0.4 && c.peso > 0).sort((a, b) => b.peso - a.peso)[0];
  if (fraco) {
    motivos.push({ tipo: 'risco', texto: `Ponto fraco em ${fraco.rotulo.toLowerCase()}: ${fraco.detalhe}` });
  }

  for (const sinal of intencao.sinais.slice(0, 2)) {
    if (sinal.contribuicao >= 12) {
      const quando = sinal.diasAtras === 0 ? 'hoje' : `ha ${sinal.diasAtras} dia${sinal.diasAtras > 1 ? 's' : ''}`;
      motivos.push({ tipo: 'intencao', texto: `${sinal.rotulo} ${quando}` });
    }
  }

  if (intencao.sinais.length === 0) {
    motivos.push({ tipo: 'risco', texto: 'Nenhum sinal de intencao registrado: abordagem fria' });
  }

  motivos.push({
    tipo: 'contato',
    texto: acessibilidade.cargoNoAlvo
      ? `Contato e ${acessibilidade.cargo}, decisor do ICP, com ${acessibilidade.canaisAtivos} canal(is) disponivel(is)`
      : `Contato e ${acessibilidade.cargo}, fora dos cargos-alvo: provavel necessidade de indicacao interna`,
  });

  if (tier === 'A') {
    motivos.push({ tipo: 'acao', texto: 'Tier A: trabalhar hoje, com abordagem personalizada' });
  }

  return motivos;
}

export function formatarBRL(valor) {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (valor >= 1_000) return `R$ ${Math.round(valor / 1000)} mil`;
  return `R$ ${Math.round(valor)}`;
}
