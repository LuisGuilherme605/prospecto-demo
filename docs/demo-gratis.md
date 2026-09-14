# Publicar a demonstração de graça

Para portfólio: colocar o painel num endereço público com HTTPS, **sem cartão de
crédito e sem servidor para administrar**.

**Tempo:** cerca de 10 minutos.

> 🔗 **Demonstração no ar:** https://teste1-k71r.onrender.com


---

## Por que aqui a regra muda

Nos outros guias, a restrição era o disco: o banco é um arquivo SQLite, e
plataformas gratuitas não o preservam entre reinícios.

**Para demonstração isso deixa de importar.** A carteira é sintética e o app a
regenera sozinho sempre que sobe. Perder o banco a cada reinício não é um defeito
— é o comportamento desejado: cada reinício devolve a demo ao estado original.

Com essa amarra removida, o plano gratuito do Render passa a servir.

---

## O modo demonstração

Por padrão o servidor **se recusa a subir** exposto sem senha, porque o painel
mostra nome, cargo, e-mail e telefone de contatos.

Numa carteira 100% gerada por algoritmo isso não se aplica — não existe pessoa
real ali. Para esse caso existe o `PROSPECTO_MODO_DEMO=1`, que:

- libera o acesso sem senha
- exibe uma **faixa permanente no topo** avisando que os dados são fictícios
- habilita o botão **Restaurar demonstração**, para o visitante desfazer o que
  mexeu e não estragar a demo de quem vier depois

Nunca use esse modo com leads de verdade. O guia para uso real é o
[DEPLOY.md](deploy.md).

---

## Passo a passo

### 1. Deixe o código na branch principal

O Render lê a branch padrão do repositório. Se o projeto ainda estiver numa
branch de trabalho, faça o merge antes — ou escolha a branch certa no passo 3.

### 2. Crie a conta

[render.com](https://render.com) → **Get Started** → entre com o GitHub.

Não pede cartão para o plano gratuito.

### 3. Crie o serviço

**New → Web Service →** conecte o repositório `Teste`.

O repositório já tem um `render.yaml`, então o Render preenche tudo sozinho. Se
ele pedir configuração manual, use:

| Campo | Valor |
|---|---|
| Runtime / Language | **Docker** |
| Plan | **Free** |
| Region | Oregon (ou qualquer uma) |
| Health Check Path | `/api/saude` |

Variáveis de ambiente:

```
PROSPECTO_MODO_DEMO = 1
PROSPECTO_ATRAS_DE_PROXY = 1
PROSPECTO_QUANTIDADE = 300
```

### 4. Publique

Clique em **Create Web Service**. O primeiro build leva de 3 a 5 minutos.

Ao final você recebe um endereço tipo
`https://prospecto-demo.onrender.com`, com HTTPS válido e certificado
renovado automaticamente.

---

## A limitação que você precisa conhecer

**O plano gratuito hiberna após 15 minutos sem acesso.** A primeira visita depois
disso espera de 30 a 60 segundos até o serviço voltar.

Para um portfólio isso é ruim: quem abre seu link e vê tela branca por 50
segundos costuma fechar antes. Três formas de lidar:

**1. Avise no link.** Ao compartilhar, escreva: *"a demo hiberna quando fica
parada; a primeira carga leva ~40s"*. Resolve a expectativa sem custo.

**2. Deixe rodando antes de mostrar.** Abra o link uns minutos antes de uma
entrevista ou reunião. Fica aquecido por 15 minutos.

**3. Pague o plano mínimo** quando for usar de verdade. Aí não hiberna.

Não recomendo montar robô de ping para manter acordado: além de ir contra o
espírito do plano gratuito, as plataformas detectam e suspendem.

---

## Alternativas, se o Render não servir

| Plataforma | Cartão | Hiberna? | Observação |
|---|---|---|---|
| **Render free** | Não | Sim, 15 min | O caminho descrito aqui |
| Koyeb free | Sim | Verificar | Camada gratuita mais enxuta; confirme as condições atuais |
| Fly.io | Sim | Configurável | ~US$ 2–3/mês, sem hibernação com `min_machines_running = 1` |
| Oracle Always Free | Sim | Não | Gratuito de verdade, mas o cadastro rejeita muito cartão brasileiro |

> Camadas gratuitas mudam com frequência. Confirme na fonte antes de decidir.

### Sem cartão e sem hibernação: rodar na sua própria máquina

Se tiver um computador que fica ligado, um túnel resolve — endereço público com
HTTPS, sem abrir porta no roteador:

```bash
# na sua máquina, com o Prospecto rodando em localhost:3000
PROSPECTO_MODO_DEMO=1 npm start

# em outro terminal
cloudflared tunnel --url http://localhost:3000
```

O `cloudflared` imprime um endereço `*.trycloudflare.com` que funciona enquanto o
comando estiver aberto. Gratuito e sem cadastro. O endereço muda a cada execução —
para um fixo, é preciso conta na Cloudflare (também gratuita).

---

## Depois, para uso real

Quando sair do portfólio e for usar com leads de verdade, mude três coisas:

1. **Tire o `PROSPECTO_MODO_DEMO`** e defina `PROSPECTO_SENHA`
2. **Adicione disco persistente** (plano pago do Render, volume no Fly, ou VPS) —
   senão os leads importados somem no próximo reinício
3. **Configure backup** — veja [DEPLOY.md](deploy.md)

O código é o mesmo; só a configuração muda.
