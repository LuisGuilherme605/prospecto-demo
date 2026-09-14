# Colocar o Prospecto no ar

Guia para sair do `localhost` e rodar num endereço público, com HTTPS, senha e
backup automático.

---

## Antes de tudo: a restrição que elimina metade das opções

O Prospecto guarda os dados num **arquivo SQLite**. Isso exige disco que
sobreviva a reinícios — e é justamente o que as plataformas *serverless* não
oferecem.

| Plataforma | Serve? | Por quê |
|---|---|---|
| Vercel, Netlify, Cloudflare Workers | **Não** | Disco efêmero: o banco é apagado a cada deploy ou requisição |
| Render (plano gratuito) | **Não** | Sem disco persistente, e o serviço hiberna após 15 min (retomada de ~50s) |
| Render (plano pago com disco) | Sim | Disco persistente é recurso pago |
| Fly.io | Sim | Volume persistente; sem camada gratuita permanente |
| **VPS com Docker** | **Sim** | Disco de verdade, controle total — inclui as VMs gratuitas da Oracle |

> Preços e camadas gratuitas mudam com frequência. Confira na fonte antes de
> escolher; o que está escrito aqui pode ter mudado desde que foi escrito.

> **É só para portfólio?** Então a restrição acima não se aplica: a carteira é
> sintética e o app a regenera a cada reinício, então disco efêmero deixa de ser
> problema e o plano gratuito do Render passa a servir, sem cartão de crédito.
> Veja **[DEMO-GRATIS.md](DEMO-GRATIS.md)**.

**A opção gratuita de verdade é a Oracle Cloud Always Free**: VM ARM com 24 GB de
RAM e 200 GB de disco, gratuita por tempo indeterminado, sempre ligada, sem
hibernação. É o caminho A abaixo.

---

## Caminho A — VPS com Docker (recomendado)

Funciona igual na Oracle Cloud Always Free, Hetzner, DigitalOcean, Contabo ou
qualquer Ubuntu/Debian.

> **Vai usar a Oracle Cloud?** Há um guia dedicado, com as telas do painel e as
> armadilhas específicas dela: **[ORACLE-CLOUD.md](ORACLE-CLOUD.md)**.

### 1. Crie a máquina

Na Oracle Cloud: **Compute → Instances → Create Instance**, escolha a *shape*
`VM.Standard.A1.Flex` (ARM — é a que entra no Always Free), imagem **Ubuntu
22.04** ou superior, e salve a chave SSH.

> Se a criação falhar com "out of capacity", é falta de estoque naquela região.
> Tente outro *availability domain* ou outra região.

Libere as portas 80 e 443 também no painel da nuvem (**Virtual Cloud Network →
Security List → Add Ingress Rules**). A Oracle bloqueia por padrão, e só o
firewall do sistema não basta.

### 2. Aponte o domínio

No seu provedor de DNS, crie um registro **A** apontando para o IP público da
máquina:

```
prospecto.seudominio.com.br   A   <IP-DA-MAQUINA>
```

Sem domínio não há HTTPS válido. Um `.com.br` sai por volta de R$ 40/ano; há
alternativas gratuitas como DuckDNS se for só para uso interno.

### 3. Instale

Conecte por SSH e rode:

```bash
curl -fsSL https://raw.githubusercontent.com/LuisGuilherme605/Teste/main/scripts/instalar-servidor.sh \
  | bash -s -- prospecto.seudominio.com.br voce@email.com
```

O script instala o Docker, baixa o projeto, **gera senha e chave de sessão
aleatórias**, configura o firewall, sobe os containers e agenda o backup diário.

Ao final ele imprime a senha gerada. **Anote na hora** — ela fica em
`/opt/prospecto/.env`.

O certificado HTTPS é emitido automaticamente em até um minuto. Abra
`https://prospecto.seudominio.com.br`.

### Se preferir fazer manualmente

```bash
git clone https://github.com/LuisGuilherme605/Teste.git /opt/prospecto
cd /opt/prospecto
cp .env.exemplo .env
nano .env                      # preencha DOMINIO, EMAIL, PROSPECTO_SENHA
openssl rand -hex 32           # cole o resultado em PROSPECTO_SEGREDO
docker compose up -d --build
```

### Operação do dia a dia

```bash
cd /opt/prospecto

docker compose logs -f app         # ver logs
docker compose restart app         # reiniciar
docker compose pull && docker compose up -d --build   # atualizar

git pull && docker compose up -d --build              # aplicar nova versão

./scripts/backup.sh --docker $(docker compose ps -q app)   # backup manual
```

**Trocar a senha:** edite `PROSPECTO_SENHA` no `.env` e rode
`docker compose up -d`. Todas as sessões abertas caem na hora — a senha faz
parte da chave que assina os cookies.

---

## Caminho B — Fly.io

Mais simples de operar (sem servidor para manter), porém pago.

```bash
curl -L https://fly.io/install.sh | sh

fly auth login
fly launch --no-deploy --copy-config          # usa o fly.toml do repositório
fly volumes create dados --size 1 --region gru

fly secrets set \
  PROSPECTO_SENHA="uma-senha-forte-e-exclusiva" \
  PROSPECTO_SEGREDO="$(openssl rand -hex 32)"

fly deploy
fly open
```

A região `gru` é São Paulo — menor latência para usuários no Brasil.

**Atenção ao escalar:** mantenha **uma única máquina**. SQLite em arquivo não
suporta duas instâncias escrevendo no mesmo volume; `fly scale count 2`
corromperia o banco. Escalar horizontalmente exigiria trocar o banco por
PostgreSQL antes.

---

## Caminho C — Render

Serve **apenas no plano com disco persistente** (pago). O plano gratuito não tem
disco: o banco seria zerado a cada deploy.

1. **New → Web Service**, conecte o repositório do GitHub
2. Ambiente: **Docker**
3. **Disks → Add Disk**: caminho `/dados`, 1 GB
4. Variáveis de ambiente: `PROSPECTO_SENHA`, `PROSPECTO_SEGREDO`,
   `PROSPECTO_BANCO=/dados/prospecto.db`, `PROSPECTO_ATRAS_DE_PROXY=1`
5. Health check path: `/api/saude`

---

## Variáveis de ambiente

| Variável | Obrigatória | O que faz |
|---|---|---|
| `PROSPECTO_SENHA` | **Sim**, fora do localhost | Senha de acesso ao painel |
| `PROSPECTO_SEGREDO` | Recomendada | Assina os cookies de sessão. Sem ela, todos são deslogados a cada reinício |
| `PROSPECTO_ATRAS_DE_PROXY` | Sim, atrás de proxy | Vale `1` quando há Caddy/Nginx/roteador da plataforma na frente |
| `PROSPECTO_BANCO` | Não | Caminho do arquivo SQLite (padrão `data/prospecto.db`) |
| `PORT` / `HOST` | Não | Porta e interface de escuta |
| `PROSPECTO_SESSAO_HORAS` | Não | Validade da sessão (padrão 12) |

Gere a chave de sessão com `openssl rand -hex 32`.

---

## Segurança

O servidor **se recusa a iniciar** se for escutar numa interface pública sem
`PROSPECTO_SENHA` definida. Isso é proposital: o painel expõe nome, cargo,
e-mail e telefone de centenas de contatos, e publicar isso sem barreira é um
vazamento de dados pessoais — com responsabilidade do publicador sob a LGPD.

O que já está implementado:

- Sessão por cookie assinado com HMAC, `HttpOnly` + `SameSite=Strict` + `Secure`
  sob HTTPS
- Limite de tentativas de login por IP, contra força bruta
- Comparação de senha em tempo constante
- CSP sem `unsafe-inline` em script, `X-Frame-Options: DENY`, `nosniff`
- Mensagens de erro interno não vazam caminho de arquivo nem *stack trace*
- App sem porta exposta: só o Caddy fala com a internet
- Container roda como usuário sem privilégio

**O que ainda não existe e você deve considerar** conforme o uso crescer:

- **Usuários individuais.** Hoje é uma senha compartilhada. Se mais de três ou
  quatro pessoas usarem, você perde rastreabilidade de quem fez o quê.
- **Registro de auditoria.** Só falhas de login são logadas; exportações de CSV
  não são.
- **Criptografia em repouso.** O arquivo SQLite fica em texto no volume. Quem
  tiver acesso ao servidor lê tudo.

---

## Backup

O script `scripts/backup.sh` usa `VACUUM INTO` do SQLite, não `cp`. A diferença
importa: copiar um SQLite com escrita em andamento gera um arquivo corrompido, e
isso só se descobre no dia em que precisar restaurar.

O instalador já agenda um backup diário às 3h, mantendo 30 dias.

**Restaurar:**

```bash
cd /opt/prospecto
docker compose stop app
gunzip -c backups/prospecto_2026-09-14_030000.db.gz > /tmp/restaurado.db
docker compose cp /tmp/restaurado.db app:/dados/prospecto.db
docker compose start app
```

Teste a restauração pelo menos uma vez. Backup nunca testado não é backup.

Para tirar cópias para fora do servidor (o que realmente protege contra perder a
máquina), sincronize a pasta `backups/` com `rclone` para qualquer nuvem de
armazenamento.

---

## Quando o SQLite deixa de servir

O banco atual aguenta com folga o caso de uso previsto: dezenas de milhares de
leads e um time comercial inteiro consultando ao mesmo tempo — as leituras são
concorrentes e a escrita é rara.

Troque por PostgreSQL quando precisar de **mais de uma instância da aplicação**
(alta disponibilidade ou escala horizontal). Não é o número de leads que força a
migração, é o número de processos escrevendo.

A troca é contida: só `src/store/repositorio.js` fala SQL. O restante do sistema
não sabe qual banco existe por baixo.
