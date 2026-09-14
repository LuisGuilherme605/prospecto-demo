# Prospecto na Oracle Cloud Always Free

Passo a passo para colocar o painel no ar de graça, num servidor sempre ligado.

**Tempo:** 30 a 45 minutos, sendo boa parte espera de propagação de DNS.
**Custo:** R$ 0 de servidor. Só o domínio (~R$ 40/ano, ou gratuito com DuckDNS).

> A interface da Oracle Cloud muda com frequência. Os nomes dos menus abaixo podem
> estar levemente diferentes — o caminho lógico continua o mesmo.

---

## O que você vai ter no final

- VM ARM com 4 vCPUs e 24 GB de RAM, gratuita por tempo indeterminado
- HTTPS válido, com renovação automática de certificado
- Senha de acesso gerada aleatoriamente
- Backup diário automático, com 30 dias de retenção

---

## Passo 1 — Criar a conta

Acesse [cloud.oracle.com](https://cloud.oracle.com) e clique em **Start for free**.

Você precisa de cartão de crédito para verificação de identidade. **A Oracle não
cobra automaticamente**: ao fim do período de teste, a conta cai para *Always
Free* e os recursos gratuitos continuam. Se quiser garantia extra, depois da
criação vá em **Billing → Upgrade and Payment** e confirme que a conta está como
*Always Free*.

Na escolha de região (**Home Region**), prefira **Brazil East (São Paulo)** ou
**Brazil Southeast (Vitória)** — menor latência, e a região não pode ser alterada
depois.

---

## Passo 2 — Criar a máquina

**Menu ☰ → Compute → Instances → Create instance**

| Campo | O que escolher |
|---|---|
| Name | `prospecto` |
| Image | **Canonical Ubuntu** 22.04 ou superior |
| Shape | **Ampere → VM.Standard.A1.Flex** |
| OCPUs | 2 (ou até 4) |
| Memória | 12 GB (ou até 24) |

> **A shape precisa ser `VM.Standard.A1.Flex`** (processador Ampere, ARM). É ela
> que entra no Always Free. As shapes `E2.1.Micro` (Intel) também são gratuitas,
> mas têm só 1 GB de RAM — apertado demais para rodar Docker com conforto.

Confirme que aparece a etiqueta **"Always Free eligible"** antes de criar.

Em **Add SSH keys**, escolha **Generate a key pair for me** e **baixe a chave
privada**. Sem ela você não entra na máquina, e não há segunda chance.

Clique em **Create**.

### Se der erro "Out of host capacity"

É o obstáculo mais comum. As VMs ARM gratuitas são disputadas e a Oracle não
mantém fila. O que funciona:

1. Tente outro **Availability Domain** (AD-1, AD-2, AD-3) no mesmo formulário
2. Reduza para 1 OCPU e 6 GB
3. Tente em horários de baixa demanda (madrugada)
4. Se persistir, crie a conta em outra região

Não existe "reservar" — é tentativa e repetição.

---

## Passo 3 — Liberar as portas no firewall da Oracle

**Este é o passo que mais gente esquece, e não dá para fazer de dentro da
máquina.** A Oracle bloqueia tudo exceto SSH por padrão.

**Menu ☰ → Networking → Virtual Cloud Networks →** clique na sua VCN **→
Security Lists →** clique na *Default Security List* **→ Add Ingress Rules**

Adicione duas regras:

| Stateless | Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|---|
| Não | `0.0.0.0/0` | TCP | `80` |
| Não | `0.0.0.0/0` | TCP | `443` |

Sem isso, o certificado HTTPS nunca é emitido e o site nunca responde — sem
nenhuma mensagem de erro útil.

---

## Passo 4 — Apontar o domínio

Copie o **Public IP address** da instância (na página da instância, seção
*Instance access*).

No painel do seu provedor de DNS (Registro.br, Cloudflare, GoDaddy…), crie:

```
Tipo: A
Nome: prospecto          (ou @ para usar o domínio raiz)
Valor: <IP-PUBLICO-DA-VM>
TTL: 300
```

**Sem domínio próprio?** Use [DuckDNS](https://www.duckdns.org) — gratuito, leva
dois minutos, e dá um endereço tipo `prospecto.duckdns.org` que funciona com
HTTPS normalmente.

Confira a propagação antes de seguir:

```bash
nslookup prospecto.seudominio.com.br
```

Só avance quando o IP retornado for o da sua VM. Pode levar de 5 minutos a
algumas horas.

---

## Passo 5 — Conectar por SSH

```bash
chmod 400 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<IP-PUBLICO>
```

O usuário é `ubuntu` (não `root`, não `opc` — `opc` é das imagens Oracle Linux).

No Windows, use o PowerShell (que já tem `ssh`) ou o PuTTY.

---

## Passo 6 — Instalar

Um comando, já dentro da máquina:

```bash
curl -fsSL https://raw.githubusercontent.com/LuisGuilherme605/Teste/main/scripts/instalar-servidor.sh \
  | bash -s -- prospecto.seudominio.com.br voce@email.com
```

O script confere o DNS antes de tentar o certificado, instala o Docker, gera
senha e chave de sessão aleatórias, configura o firewall do sistema (inclusive a
regra de `iptables` que as imagens Ubuntu da Oracle trazem bloqueando tudo),
sobe os containers, agenda o backup diário e espera o HTTPS responder.

Ao final ele imprime a senha gerada. **Anote na hora.**

### Prefere não executar script da internet direto?

Legítimo. Faça na mão:

```bash
sudo apt-get update && sudo apt-get install -y git
curl -fsSL https://get.docker.com | sudo sh

sudo git clone https://github.com/LuisGuilherme605/Teste.git /opt/prospecto
cd /opt/prospecto

sudo cp .env.exemplo .env
sudo nano .env      # preencha DOMINIO, EMAIL e PROSPECTO_SENHA
openssl rand -hex 32   # cole o resultado em PROSPECTO_SEGREDO

sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent

sudo docker compose up -d --build
```

---

## Passo 7 — Entrar

Abra `https://prospecto.seudominio.com.br` e use a senha que o script imprimiu.

O certificado leva até um minuto para ser emitido na primeira vez.

---

## Quando não funciona

### O site não abre de jeito nenhum

Quase sempre é o **Passo 3** (Security List da Oracle). Confirme de fora da
máquina:

```bash
curl -v http://prospecto.seudominio.com.br
```

Se der *timeout*, é firewall da nuvem. Se der *connection refused*, o container
não está rodando.

### "connection refused"

```bash
cd /opt/prospecto
docker compose ps           # os dois containers devem estar "running"
docker compose logs app     # o que o Prospecto diz
docker compose logs caddy   # o que o Caddy diz sobre o certificado
```

Se o `app` sai logo após subir com *"Recusando iniciar"*, falta
`PROSPECTO_SENHA` no `.env`. É proposital: o painel não sobe exposto sem senha.

### Certificado não é emitido

```bash
docker compose logs caddy | grep -i "certificate\|error"
```

Causas, em ordem de frequência: porta 80 fechada na Oracle; DNS apontando para
outro IP; limite de tentativas do Let's Encrypt atingido (5 falhas por hora —
espere uma hora).

### Esqueci a senha

```bash
sudo grep PROSPECTO_SENHA /opt/prospecto/.env
```

Para trocar: edite o `.env` e rode `docker compose up -d`. Todas as sessões
abertas caem na hora.

### A VM sumiu

Contas *Always Free* podem ter recursos recuperados após longos períodos de
ociosidade. Um painel em uso diário não corre esse risco, mas **é mais um motivo
para manter os backups fora do servidor** (veja abaixo).

---

## Operação

```bash
cd /opt/prospecto

docker compose logs -f app                            # acompanhar
docker compose restart app                            # reiniciar
git pull && docker compose up -d --build              # atualizar
./scripts/backup.sh --docker $(docker compose ps -q app)   # backup manual
ls -lh backups/                                       # backups existentes
```

### Backups fora do servidor

O backup automático diário fica **na própria máquina** — o que não protege contra
perder a máquina. Para copiar para fora:

```bash
sudo apt-get install -y rclone
rclone config                 # configure Google Drive, S3, Backblaze...
```

E acrescente ao cron:

```bash
0 4 * * * rclone sync /opt/prospecto/backups remoto:prospecto-backups
```

---

## Importar seus leads de verdade

O painel sobe com uma carteira de exemplo. Para usar seus dados:

```bash
cd /opt/prospecto
# envie seu CSV para o servidor primeiro (do seu computador):
#   scp -i sua-chave.key leads.csv ubuntu@<IP>:/tmp/

docker compose cp /tmp/leads.csv app:/tmp/leads.csv
docker compose exec app node --experimental-sqlite bin/prospecto.js importar /tmp/leads.csv
docker compose restart app
```

O formato esperado está em `exemplos/leads.csv`. O importador aceita CSV do Excel
brasileiro (ponto e vírgula, acentos, BOM) e deduplica na entrada.
