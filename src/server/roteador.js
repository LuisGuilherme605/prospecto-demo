/**
 * Roteador HTTP minimo com suporte a parametros de caminho.
 *
 * Nao usamos framework porque o projeto inteiro e zero-dependencia; a API tem
 * pouco mais de uma duzia de rotas e um roteador honesto cabe em 60 linhas.
 */

export class Roteador {
  #rotas = [];

  adicionar(metodo, padrao, manipulador) {
    const nomes = [];
    const regex = new RegExp(`^${padrao
      .replace(/\/:([a-zA-Z]+)/g, (_, nome) => { nomes.push(nome); return '/([^/]+)'; })
      .replace(/\*$/, '.*')}$`);
    this.#rotas.push({ metodo, regex, nomes, manipulador });
    return this;
  }

  get(padrao, manipulador) { return this.adicionar('GET', padrao, manipulador); }
  post(padrao, manipulador) { return this.adicionar('POST', padrao, manipulador); }
  put(padrao, manipulador) { return this.adicionar('PUT', padrao, manipulador); }
  patch(padrao, manipulador) { return this.adicionar('PATCH', padrao, manipulador); }
  delete(padrao, manipulador) { return this.adicionar('DELETE', padrao, manipulador); }

  /** Encontra a rota que casa; devolve `null` quando nenhuma casa. */
  resolver(metodo, caminho) {
    for (const rota of this.#rotas) {
      if (rota.metodo !== metodo) continue;
      const casamento = rota.regex.exec(caminho);
      if (!casamento) continue;
      const parametros = {};
      rota.nomes.forEach((nome, indice) => { parametros[nome] = decodeURIComponent(casamento[indice + 1]); });
      return { manipulador: rota.manipulador, parametros };
    }
    return null;
  }
}

/** Erro com status HTTP, para o tratamento centralizado converter em resposta. */
export class ErroHttp extends Error {
  constructor(status, mensagem, detalhes = null) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.detalhes = detalhes;
  }
}
