/**
 * Gerador pseudoaleatorio deterministico.
 *
 * Toda a geracao de dados do Prospecto precisa ser reproduzivel: a mesma semente
 * tem de produzir exatamente a mesma carteira de leads, em qualquer maquina e em
 * qualquer versao do Node. Por isso nao usamos Math.random em lugar nenhum do
 * dominio -- o algoritmo (mulberry32) esta implementado aqui e e estavel.
 */

const MASK = 0xffffffff;

/** Converte uma string em uma semente inteira de 32 bits (FNV-1a). */
export function seedFrom(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Cria um fluxo aleatorio deterministico.
 * @param {number|string} seed
 */
export function createRng(seed) {
  let state = (typeof seed === 'number' ? seed : seedFrom(seed)) >>> 0;

  /** Proximo float no intervalo [0, 1). */
  function next() {
    state = (state + 0x6d2b79f5) & MASK;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** Inteiro em [min, max]. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** Float em [min, max). */
    float(min, max) {
      return min + next() * (max - min);
    },
    /** true com probabilidade `p`. */
    chance(p) {
      return next() < p;
    },
    /** Item aleatorio de um array. */
    pick(items) {
      if (items.length === 0) throw new RangeError('pick recebeu lista vazia');
      return items[Math.floor(next() * items.length)];
    },
    /**
     * Item aleatorio respeitando pesos.
     * @param {Array<{value: unknown, weight: number}>} entries
     */
    weighted(entries) {
      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      if (total <= 0) throw new RangeError('pesos precisam somar mais que zero');
      let roll = next() * total;
      for (const entry of entries) {
        roll -= entry.weight;
        if (roll <= 0) return entry.value;
      }
      return entries[entries.length - 1].value;
    },
    /** `count` itens distintos, sem repeticao (Fisher-Yates parcial). */
    sample(items, count) {
      const pool = [...items];
      const take = Math.min(count, pool.length);
      for (let i = 0; i < take; i += 1) {
        const j = i + Math.floor(next() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, take);
    },
    /** Embaralha uma copia da lista. */
    shuffle(items) {
      const pool = [...items];
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool;
    },
    /**
     * Amostra de uma normal truncada -- util para distribuir porte de empresa e
     * ticket sem gerar valores absurdos nas caudas.
     */
    normal(mean, stdDev, min = -Infinity, max = Infinity) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const u1 = Math.max(next(), Number.EPSILON);
        const u2 = next();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const value = mean + z * stdDev;
        if (value >= min && value <= max) return value;
      }
      return Math.min(Math.max(mean, min), max);
    },
  };
}
