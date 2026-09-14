/**
 * Deduplicacao de leads.
 *
 * Lista comprada + export do CRM + planilha do time = a mesma empresa tres
 * vezes, escrita de tres jeitos. Sem isso, o ranking mostra o mesmo lead em
 * posicoes diferentes e o prospect recebe a mesma sequencia de tres vendedores,
 * que e o pior resultado possivel.
 */

/** Normaliza nome de empresa removendo acentos, pontuacao e sufixos societarios. */
export function normalizarEmpresa(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|epp|sa|s\/a|eireli|mei|inc|llc|corp|group|grupo)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Normaliza dominio: tira protocolo, `www.` e caminho. */
export function normalizarDominio(valor) {
  if (!valor) return '';
  return String(valor)
    .toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
}

/**
 * Distancia de edicao limitada (Levenshtein com corte).
 * O corte evita percorrer a matriz inteira quando ja e obvio que as strings sao
 * diferentes demais -- importante ao comparar milhares de leads.
 */
export function distanciaEdicao(a, b, limite = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limite) return limite + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let menorNaLinha = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      menorNaLinha = Math.min(menorNaLinha, atual[j]);
    }
    if (menorNaLinha > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Confianca de que dois leads sao a mesma empresa (0 a 1).
 * Dominio identico e prova forte; nome parecido sozinho e indicio.
 */
export function confiancaDeDuplicata(a, b) {
  const dominioA = normalizarDominio(a.dominio);
  const dominioB = normalizarDominio(b.dominio);
  if (dominioA && dominioA === dominioB) return 1;

  const emailA = normalizarDominio((a.contato?.email ?? '').split('@')[1]);
  const emailB = normalizarDominio((b.contato?.email ?? '').split('@')[1]);
  if (emailA && emailA === emailB) return 0.95;

  const nomeA = normalizarEmpresa(a.empresa);
  const nomeB = normalizarEmpresa(b.empresa);
  if (!nomeA || !nomeB) return 0;
  if (nomeA === nomeB) return 0.9;

  const distancia = distanciaEdicao(nomeA, nomeB, 3);
  if (distancia > 3) return 0;
  const similaridade = 1 - distancia / Math.max(nomeA.length, nomeB.length);
  return similaridade >= 0.85 ? similaridade * 0.8 : 0;
}

/**
 * Agrupa duplicatas e devolve a lista limpa.
 *
 * O registro sobrevivente e o mais completo (mais campos preenchidos, mais
 * sinais), e os sinais dos duplicados sao incorporados nele -- descartar sinal
 * de intencao por causa de deduplicacao seria jogar fora o dado mais valioso.
 */
export function deduplicar(leads, limiar = 0.85) {
  const grupos = [];
  const indicePorDominio = new Map();

  for (const lead of leads) {
    const dominio = normalizarDominio(lead.dominio);
    let grupo = dominio ? indicePorDominio.get(dominio) : undefined;

    if (!grupo) {
      grupo = grupos.find((g) => confiancaDeDuplicata(g.principal, lead) >= limiar);
    }

    if (grupo) {
      // O grupo guarda todos os membros: trocar o sobrevivente nao pode fazer o
      // registro anterior desaparecer, senao os sinais dele somem na mesclagem.
      grupo.membros.push(lead);
      if (completude(lead) > completude(grupo.principal)) grupo.principal = lead;
    } else {
      grupo = { principal: lead, membros: [lead] };
      grupos.push(grupo);
      if (dominio) indicePorDominio.set(dominio, grupo);
    }
  }

  const unicos = grupos.map((grupo) => {
    if (grupo.membros.length === 1) return grupo.principal;
    const sinais = mesclarSinais(grupo.membros.flatMap((l) => l.sinais ?? []));
    const tecnologias = [...new Set(grupo.membros.flatMap((l) => l.tecnologias ?? []))];
    return { ...grupo.principal, sinais, tecnologias, duplicatasMescladas: grupo.membros.length - 1 };
  });

  return {
    unicos,
    removidos: leads.length - unicos.length,
    grupos: grupos.filter((g) => g.membros.length > 1).map((g) => ({
      mantido: g.principal.empresa,
      mesclados: g.membros.filter((m) => m !== g.principal).map((d) => d.empresa),
    })),
  };
}

/** Mescla sinais mantendo, de cada tipo, apenas a ocorrencia mais recente. */
function mesclarSinais(sinais) {
  const maisRecentePorTipo = new Map();
  for (const sinal of sinais) {
    const atual = maisRecentePorTipo.get(sinal.tipo);
    if (!atual || new Date(sinal.data) > new Date(atual.data)) maisRecentePorTipo.set(sinal.tipo, sinal);
  }
  return [...maisRecentePorTipo.values()].sort((a, b) => new Date(b.data) - new Date(a.data));
}

/** Pontua o quao completo um registro e, para escolher o sobrevivente. */
function completude(lead) {
  let pontos = 0;
  for (const campo of ['dominio', 'setor', 'funcionarios', 'receitaAnual', 'regiao', 'cidade', 'maturidadeDigital']) {
    if (lead[campo]) pontos += 1;
  }
  for (const canal of ['email', 'telefone', 'linkedin', 'nome', 'cargo']) {
    if (lead.contato?.[canal]) pontos += 1;
  }
  pontos += Math.min((lead.sinais ?? []).length, 5);
  pontos += Math.min((lead.tecnologias ?? []).length, 5) * 0.5;
  return pontos;
}
