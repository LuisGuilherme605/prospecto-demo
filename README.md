# Prospecto

Motor de prospecção B2B que transforma uma lista de leads em uma fila de trabalho
justificada: quem contatar hoje, por qual canal, com qual mensagem e por quê.

Roda com **zero dependências externas**. Clonou, rodou — não há `npm install`, não
há chave de API, não há serviço externo. Só Node 22.

```bash
git clone https://github.com/LuisGuilherme605/Teste.git prospecto
cd prospecto
npm run demo
```

---

## O problema

Toda operação comercial de PME tem o mesmo gargalo: **a lista existe, a decisão não**.
O time abre uma planilha com 800 nomes e começa de cima, ou pelo que lembrou, ou pelo
que respondeu por último. O resultado é sempre o mesmo — os melhores leads esfriam na
fila enquanto o time trabalha os que estavam mais à mão.

Ferramentas de scoring costumam responder isso com um número. "Lead 84." Um número não
muda comportamento nenhum: o vendedor não sabe se liga ou escreve, o que dizer, nem por
que esse lead veio antes do outro.

O Prospecto responde a pergunta inteira:

> **VetorTech Brasil, score 91, tier A.** Porque está no setor-alvo, tem 120
> funcionários dentro da faixa ideal, usa RD Station, abriu vaga de SDR há 6 dias e o
> contato é o Head de Vendas com três canais disponíveis. **Ação: ligar hoje.**
> Cadência sugerida: trilha de contratação, 6 toques em 13 dias.

---

## Como o score é construído

Três dimensões independentes, combinadas por pesos configuráveis. Separá-las importa:
um lead pode ter ótimo perfil e nenhuma intenção (trabalhe depois), ou muita intenção e
perfil ruim (não perca tempo). Um número só esconde essa diferença.

| Dimensão | O que mede | Comportamento |
|---|---|---|
| **Fit** (50%) | Aderência estrutural ao ICP: setor, porte, receita, região, stack, maturidade | Muda devagar |
| **Intenção** (35%) | Sinais de compra, já com decaimento temporal | Volátil, perde valor todo dia |
| **Acessibilidade** (15%) | Dá para falar com quem decide, e por qual canal | Operacional |

### Decisões de modelagem que mudam o resultado

**Proximidade por razão, não por diferença.** Uma empresa de 10 pessoas num ICP de
30–300 não está "20 unidades" abaixo — ela é três vezes menor. Medindo a distância
absoluta contra a amplitude da faixa, ela pontuaria 88% em porte, o que é falso. Pela
razão, 10/30 = 33%, que é o que um vendedor diria olhando. O mesmo cálculo serve para
funcionários e para reais sem calibrar duas vezes.

**Decaimento exponencial por tipo de sinal.** Cada sinal tem meia-vida própria. Uma
visita à página de preços perde metade do peso em 10 dias; uma rodada de investimento,
em 120. É isso que separa uma lista de leads de uma fila de trabalho: sem decaimento, o
lead que visitou o preço em janeiro compete de igual para igual com quem visitou ontem.

**Saturação, não soma.** Dez aberturas de e-mail não valem mais que uma resposta, e a
quinta tecnologia compatível não acrescenta o que a segunda acrescentou. Sem curva de
rendimento decrescente, quem gera muito ruído domina o ranking.

**Bloqueio é eliminatório, não desconto.** Um lead que bate em critério de bloqueio do
ICP tem o score travado em 25, por mais intenção que demonstre. Desqualificado não pode
subir de posição.

**Média geométrica em acessibilidade.** Poder sem alcance vira frustração; alcance sem
poder vira reunião inútil. A média geométrica pune quem é fraco em qualquer um dos dois
— um CEO decide muito e responde pouco, e o modelo sabe disso.

**A fila não é o ranking.** A ordenação usa score ajustado por urgência (até +30%):
dois leads 80, em que um esfriou e o outro visitou o preço ontem, não ocupam a mesma
posição. E a fila do dia tem **reserva por tier** — sem ela o time só trabalha tier A,
o funil de médio prazo seca e três meses depois o mês fecha vazio.

---

## O que o projeto faz

### Priorização com justificativa

```
$ prospecto ranking --tier A --limite 5

#  EMPRESA            TIER  SCORE   FIT  INT   ACS  POTENCIAL  PROXIMA ACAO
1  NovaStore Brasil   A      91.0  94.0   92  78.6  R$ 36.000  abordagem_por_gatilho
2  DeltaMove          A      91.4  95.0   92  79.0  R$ 54.000  abordagem_por_gatilho
3  NexoBuild Digital  A      88.6  94.0   92  64.0  R$ 48.000  ligar_agora
```

### Fila de trabalho do dia

```
$ prospecto fila --capacidade 25

QUANDO  EMPRESA            TIER  CANAL     ACAO              POR QUE AGORA
hoje    NexoBuild Digital  A     telefone  ligar_agora       Resposta nas ultimas 72h: velocidade define a conversao
hoje    ClaraMed Servicos  A     telefone  ligar_agora       Resposta nas ultimas 72h: velocidade define a conversao
1d      NexoShop           A     email     abordagem_direta  Visitou a pagina de precos ha menos de 5 dias
```

### Breakdown completo de um lead

```
$ prospecto lead LD-00080

SCORE 91 (tier A)   posicao 1 de 300
  fit                94  #######################.  peso 50%
  intencao         92.1  ######################..  peso 35%
  acessibilidade   78.6  ###################.....  peso 15%

SINAIS DE INTENCAO
  Captou investimento            ha 8d  frescor 96%  +89.07
  Solicitou demonstracao         ha 6d  frescor 87%  +79.34
  Trocou lideranca da area       ha 2d  frescor 98%  +68.64
```

### Cadência de contato gerada a partir do gatilho real

A trilha é escolhida pelo sinal mais forte do lead — quem abriu vaga de SDR recebe um
ângulo diferente de quem visitou a página de preços. O texto sai pronto para revisão
humana; o vendedor edita, não escreve do zero.

```
$ prospecto cadencia LD-00080 --remetente "Luis Guilherme"

CADENCIA - NovaStore Brasil (tier A)
Trilha   Visita a pagina de precos | tom direto
Angulo   A pessoa ja esta avaliando. Nao vender o problema, resolver a duvida que trava a decisao.
Esforco  6 toques em 13 dias, ~39 min no total

--- Toque 1 | dia 0 | EMAIL ---
Assunto: Duvida sobre o plano certo para a NovaStore Brasil

Oi Carla, tudo bem?

Vi que voces pediram uma demonstracao por aqui.

Na maioria das empresas de E-commerce e Varejo com 174 pessoas, o gargalo esta em
recuperacao de carrinho e recompra -- nao por falta de esforco, mas porque o processo
depende de alguem lembrar de fazer o follow-up.

Faz sentido eu te mandar em duas linhas como isso funcionaria ai? Se nao for
prioridade agora, e so me dizer que eu paro.
```

São 7 trilhas (preços, contratação, captação, troca de liderança, migração de
concorrente, reativação, fit puro) e a estrutura de toques varia por tier: tier A recebe
6 toques multicanal, tier D recebe um e-mail de nutrição.

### Previsão de pipeline em três cenários

A probabilidade é composta **por etapa que ainda falta**, não chutada sobre o total. A
faixa vem de propagação de variância de Bernoulli — mais honesta que ±20% fixo, porque a
incerteza cresce com a quantidade de negócios duvidosos, não com o tamanho do pipeline.

```
$ prospecto previsao --meta 1500000

  Conservador        R$ 302.962
  Base               R$ 460.829
  Otimista           R$ 618.696

META R$ 1.500.000  |  cobertura 31%
  Pipeline insuficiente para a meta: falta volume de topo de funil, nao esforco de fechamento
  Falta R$ 1.039.171, equivalente a ~591 leads do mesmo perfil.
```

O diagnóstico responde a pergunta que o gestor realmente faz: não "quanto vou fechar",
mas **"o que falta e de que tipo é o problema"**.

### Importação de CSV com deduplicação

Lista comprada + export do CRM + planilha do time = a mesma empresa três vezes, escrita
de três jeitos. O parser de CSV é próprio e aguenta o que vem do Excel brasileiro:
ponto e vírgula, BOM, aspas escapadas, quebra de linha dentro da célula.

```
$ prospecto importar exemplos/leads.csv

7 leads importados de exemplos/leads.csv
1 duplicatas mescladas:
  Ferragens Norte Ltda <- FERRAGENS NORTE
```

O registro sobrevivente é o mais completo, e os **sinais de intenção de todos os
duplicados são incorporados nele** — descartar sinal por causa de deduplicação seria
jogar fora o dado mais valioso do lead.

### Painel web

`npm start` e abra `http://localhost:3000`. Indicadores, distribuição por tier, funil,
previsão com marcador de meta, tabela priorizada com filtros, e uma gaveta por lead com
o breakdown completo e o gerador de cadência. Editor de ICP com sliders — mover um peso
repriorizado a carteira inteira na hora.

Tema claro e escuro, responsivo até 390px, sem framework e sem etapa de build.

> Sobre as cores: tier é uma **ordem**, não uma categoria. O painel usa uma rampa
> ordinal de um único tom (azul, escuro → claro) em vez de quatro cores diferentes —
> quatro cores fariam o olho procurar significado onde só existe posição. A rampa foi
> validada para monotonicidade de luminosidade e contraste contra a superfície nos dois
> temas.

---

## Comandos

```
prospecto demo                     Popula o banco e mostra o panorama completo
prospecto semear                   Gera uma carteira sintética determinística
prospecto importar <arquivo.csv>   Importa leads deduplicando na entrada
prospecto ranking                  Lista os leads ordenados por prioridade
prospecto fila                     Monta a fila do dia respeitando a capacidade
prospecto lead <id>                Abre um lead com o breakdown completo
prospecto cadencia <id>            Gera a sequência de contato
prospecto previsao                 Projeta o pipeline em três cenários
prospecto resumo                   Panorama agregado da carteira
prospecto icp                      Mostra o ICP em uso
prospecto exportar                 Exporta a carteira priorizada em CSV
prospecto servir                   Sobe o painel web e a API
```

Todo comando aceita `--json`, para encadear com outras ferramentas:

```bash
prospecto ranking --tier A --json | jq -r '.[] | [.empresa, .contato.email] | @tsv'
```

Opções principais: `--banco`, `--quantidade`, `--semente`, `--limite`, `--capacidade`,
`--tier`, `--setor`, `--estagio`, `--meta`, `--horizonte`, `--porta`, `--remetente`,
`--saida`, `--json`, `--forcar`. Detalhes em `prospecto --ajuda`.

---

## API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/resumo` | Panorama agregado da carteira |
| GET | `/api/leads` | Lista priorizada com filtros e paginação |
| GET | `/api/leads/:id` | Lead com breakdown completo do score |
| GET | `/api/fila?capacidade=25` | Fila de trabalho do dia |
| GET | `/api/previsao?meta=1500000` | Projeção em três cenários |
| GET | `/api/icp` · PUT | Lê e grava o ICP (valida e repriorizado) |
| POST | `/api/leads/:id/cadencia` | Gera a sequência de contato |
| POST | `/api/leads/:id/sinais` | Registra sinal e recalcula o score |
| PATCH | `/api/leads/:id/estagio` | Move o lead no funil |
| GET | `/api/exportar.csv` | Exporta a carteira priorizada |

Erros de validação voltam em 422 com a **lista completa de problemas** — o objetivo é
corrigir tudo de uma vez, não descobrir um erro por requisição.

---

## Como biblioteca

O motor não depende de servidor nem de banco:

```js
import { avaliarLead, normalizarIcp, gerarCadencia } from './src/index.js';

const icp = normalizarIcp({ setoresAlvo: ['industria'], funcionariosIdeal: { min: 50, max: 500 } });
const avaliacao = avaliarLead(meuLead, icp);

console.log(avaliacao.score, avaliacao.tier);
avaliacao.motivos.forEach((m) => console.log(m.texto));
```

---

## Arquitetura

```
bin/prospecto.js      CLI
src/
  core/               Regra de negócio pura, sem I/O
    icp.js              Perfil de Cliente Ideal, com validação acumulativa
    scoring.js          Motor de score explicável (fit, intenção, acessibilidade)
    priorizacao.js      Ranking, urgência, próxima ação, fila do dia
    cadencia.js         Trilhas e geração da sequência de contato
    previsao.js         Probabilidade por etapa e projeção de pipeline
  data/
    taxonomy.js         Vocabulário do domínio: setores, cargos, sinais
    gerador.js          Carteira sintética determinística
  store/                SQLite nativo do Node; único lugar com SQL
  server/               HTTP e API; sem regra de negócio
  lib/                  CSV, deduplicação, PRNG, formatação de terminal
public/               Painel web (sem build)
test/                 174 testes com node:test
```

**A regra de dependência é de mão única:** `core` não importa `store` nem `server`. É
isso que permite usar o motor como biblioteca, testá-lo sem subir nada e ter a certeza
de que CLI e painel nunca divergem — os dois chamam exatamente o mesmo código.

**Tudo é determinístico.** Nenhum `Math.random` no domínio: o PRNG é próprio e semeado,
então a mesma semente produz a mesma carteira em qualquer máquina, e o mesmo lead
produz o mesmo score sempre. Sem isso, nenhum teste de ranking seria confiável.

---

## Testes

```bash
npm test         # 174 testes
npm run coverage # 98,8% de linhas
```

Os testes cobrem propriedades que precisam valer sempre (monotonicidade, limites,
decaimento, determinismo) e as fronteiras de decisão — não números mágicos, que
tornariam qualquer recalibração do modelo uma quebra de teste. A API sobe de verdade em
porta efêmera e é exercitada por `fetch`, incluindo os caminhos de erro: 404, 422 com
lista de problemas, 400 em JSON malformado e bloqueio de travessia de diretório.

Uma varredura roda o gerador de cadência sobre 250 leads sintéticos e falha se qualquer
combinação de trilha e tier deixar um `{{placeholder}}` vazar para o texto final.

---

## Requisitos

Node 22.5 ou superior — a persistência usa `node:sqlite`, que ainda é marcado como
experimental e por isso pede a flag `--experimental-sqlite` (os scripts do `npm` já a
incluem).

---

## Licença

MIT. Veja [LICENSE](LICENSE).
