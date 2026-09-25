# Contribuindo

Obrigado pelo interesse. Este guia é curto de propósito — o projeto é pequeno e o
processo deveria ser também.

## Antes de começar

Para mudanças pequenas (correção de bug, ajuste de texto, teste faltando), pode abrir o
PR direto. Para qualquer coisa maior — nova funcionalidade, mudança de comportamento do
score, nova dependência — abra uma issue primeiro descrevendo o que você propõe. Evita
trabalho jogado fora se a direção não fizer sentido para o projeto.

## Rodando localmente

```bash
git clone https://github.com/LuisGuilherme605/prospecto-demo.git prospecto
cd prospecto
npm test
```

Sem instalação: o projeto não tem dependências, então `git clone` + `npm test` é tudo
que você precisa para validar que está tudo funcionando antes de mexer em qualquer
coisa.

```bash
npm test          # suíte completa
npm run coverage  # com relatório de cobertura
npm run demo      # gera uma carteira de exemplo e mostra o painel na CLI
npm start         # sobe o painel web em localhost:3000
```

## Regra que não se negocia: zero dependências

O `CI` falha se `dependencies` ou `devDependencies` deixarem de estar vazios em
`package.json`. Isso é intencional, não esquecimento — é a diferença entre "clonou,
rodou" e "clonou, rodou `npm install`, esperou, torceu para não ter vulnerabilidade na
árvore de pacotes". Se sua mudança parece precisar de um pacote externo, é sinal para
repensar a abordagem, não para abrir exceção.

Isso vale para dependências de execução. Ferramentas usadas só para validar localmente
(como as que o Playwright usa em `docs/`, fora do pacote publicado) não contam.

## Estilo de código

Não há linter configurado — a consistência vem de ler o código ao redor e escrever
igual. Alguns padrões que o projeto segue à risca:

- **Comentários em português, explicando o *porquê*, não o *o quê*.** O código já diz o
  que faz; o comentário existe para a decisão que não está óbvia olhando só a linha.
- **`core/` não importa `store/` nem `server/`.** É essa regra que permite usar o motor
  como biblioteca e testar sem subir servidor nenhum. Uma mudança que quebra essa
  direção de dependência não é aceita, por mais conveniente que pareça no momento.
- **Nada de `Math.random()` no domínio.** Todo sorteio passa pelo gerador determinístico
  em `src/lib/rng.js`. Sem isso, nenhum teste de ranking seria confiável.
- **Nomes de função e variável em português**, como o resto do projeto. Consistência
  importa mais que preferência pessoal aqui.

## Testes

Toda mudança de comportamento precisa de teste cobrindo o que mudou. O projeto usa
`node:test` — sem framework externo, por causa da regra de zero dependências acima.

Os testes existentes miram *propriedades* (monotonicidade, limites, determinismo), não
números fixos — um número fixo quebra a cada ajuste de calibração do modelo, mesmo
quando o ajuste é o comportamento certo. Prefira esse estilo:

```js
// Evite:
assert.equal(calcularScore(lead), 84.2);

// Prefira:
assert.ok(calcularScore(leadComMaisIntencao) > calcularScore(leadComMenosIntencao));
```

## Enviando o PR

- Título e descrição em português, como o resto do histórico do projeto.
- Mensagens de commit explicam o *porquê* da mudança, não só o *o quê* — `git log` tem
  bons exemplos disso.
- `npm test` precisa passar localmente antes do push. O CI roda a mesma suíte em Node 22
  e 24, além de conferir que nenhum arquivo de código-fonte ficou de fora do controle de
  versão (já aconteceu uma vez, veja o histórico) e que o servidor se recusa a subir
  exposto sem senha.
- Um PR resolve uma coisa. PRs grandes misturando funcionalidade nova com refatoração
  não relacionada são mais difíceis de revisar e mais fáceis de recusar.

## Segurança

Encontrou uma vulnerabilidade em vez de um bug comum? Veja [`SECURITY.md`](SECURITY.md)
— vulnerabilidade não vai em issue pública.
