#!/usr/bin/env bash
#
# Instala o Prospecto num servidor Ubuntu/Debian limpo.
#
# Pensado para a VM gratuita da Oracle Cloud (Always Free), mas funciona em
# qualquer VPS. Instala Docker, configura o firewall, gera os segredos e sobe o
# servico com HTTPS automatico.
#
# Uso, no servidor:
#   curl -fsSL <url-do-script> | bash -s -- prospecto.seudominio.com.br voce@email.com
#
# Variaveis opcionais:
#   PROSPECTO_BRANCH  branch do repositorio a usar (padrao: main)
#   PROSPECTO_REPO    URL do repositorio
#   PROSPECTO_DIR     diretorio de instalacao (padrao: /opt/prospecto)

set -euo pipefail

DOMINIO="${1:-}"
EMAIL="${2:-}"
REPO="${PROSPECTO_REPO:-https://github.com/LuisGuilherme605/prospecto-demo.git}"
BRANCH="${PROSPECTO_BRANCH:-main}"
DESTINO="${PROSPECTO_DIR:-/opt/prospecto}"

if [[ -z "$DOMINIO" || -z "$EMAIL" ]]; then
  cat >&2 <<AJUDA
Uso: $0 <dominio> <email>

  <dominio>  nome ja apontado por DNS para o IP desta maquina
  <email>    endereco para os avisos do Let's Encrypt

Exemplo:
  $0 prospecto.minhaempresa.com.br luis@minhaempresa.com.br
AJUDA
  exit 1
fi

executar() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi; }
passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
aviso() { printf '\033[33m[aviso]\033[0m %s\n' "$1"; }
erro()  { printf '\033[31m[erro]\033[0m %s\n' "$1" >&2; }

passo "Conferindo o ambiente"
ARQUITETURA=$(uname -m)
echo "Arquitetura: $ARQUITETURA  (as imagens usadas suportam x86_64 e ARM64)"

if [[ ! -f /etc/debian_version ]]; then
  erro "Este script espera Ubuntu ou Debian. Detectado: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
  erro "Na Oracle Cloud, escolha a imagem Ubuntu ao criar a instancia."
  exit 1
fi

# Conferir o DNS ANTES de subir qualquer coisa.
#
# O Let's Encrypt limita as tentativas falhas por dominio por hora. Se o DNS
# ainda nao propagou, o Caddy tenta, falha, e o dominio fica em espera --
# transformando um erro de 2 minutos numa espera de 1 hora.
passo "Conferindo o DNS de $DOMINIO"
IP_PUBLICO=$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || echo '')
IP_DOMINIO=$(getent hosts "$DOMINIO" 2>/dev/null | awk '{print $1}' | head -1 || echo '')

echo "IP desta maquina: ${IP_PUBLICO:-nao foi possivel descobrir}"
echo "IP do dominio:    ${IP_DOMINIO:-nao resolve}"

if [[ -z "$IP_DOMINIO" ]]; then
  aviso "$DOMINIO ainda nao resolve. Crie o registro A apontando para $IP_PUBLICO."
  aviso "A propagacao leva de alguns minutos a algumas horas."
  aviso "A instalacao continua, mas o certificado HTTPS so sera emitido quando o DNS propagar."
elif [[ -n "$IP_PUBLICO" && "$IP_DOMINIO" != "$IP_PUBLICO" ]]; then
  aviso "$DOMINIO aponta para $IP_DOMINIO, que nao e o IP desta maquina ($IP_PUBLICO)."
  aviso "Corrija o registro A antes de esperar o HTTPS funcionar."
fi

passo "Instalando dependencias"
executar apt-get update -qq
executar apt-get install -y -qq ca-certificates curl git openssl

if ! command -v docker >/dev/null 2>&1; then
  passo "Instalando Docker"
  curl -fsSL https://get.docker.com | executar sh
  executar systemctl enable --now docker
else
  echo "Docker ja instalado: $(docker --version)"
fi

passo "Baixando o projeto em $DESTINO"
if [[ -d "$DESTINO/.git" ]]; then
  executar git -C "$DESTINO" fetch origin "$BRANCH"
  executar git -C "$DESTINO" checkout "$BRANCH"
  executar git -C "$DESTINO" pull --ff-only origin "$BRANCH"
else
  executar git clone --depth 1 --branch "$BRANCH" "$REPO" "$DESTINO"
fi

cd "$DESTINO"

SENHA_NOVA=0
if [[ ! -f .env ]]; then
  passo "Gerando .env com segredos aleatorios"
  SENHA=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
  SEGREDO=$(openssl rand -hex 32)
  executar tee .env >/dev/null <<ENV
DOMINIO=$DOMINIO
EMAIL=$EMAIL
PROSPECTO_SENHA=$SENHA
PROSPECTO_SEGREDO=$SEGREDO
PROSPECTO_SESSAO_HORAS=12
ENV
  executar chmod 600 .env
  SENHA_NOVA=1
else
  echo ".env ja existe; mantendo a senha atual."
fi

passo "Configurando o firewall do sistema"
if command -v ufw >/dev/null 2>&1; then
  executar ufw allow 22/tcp  >/dev/null 2>&1 || true
  executar ufw allow 80/tcp  >/dev/null 2>&1 || true
  executar ufw allow 443/tcp >/dev/null 2>&1 || true
  executar ufw --force enable >/dev/null 2>&1 || true
  echo "ufw configurado."
fi

# As imagens Ubuntu da Oracle vem com uma regra REJECT no fim da cadeia INPUT,
# entao so liberar no ufw nao basta: e preciso inserir a regra ANTES dela (-I).
# E sem o pacote de persistencia, tudo se perde no proximo reboot -- que e como
# as pessoas descobrem, semanas depois, que o site "caiu sozinho".
if command -v iptables >/dev/null 2>&1; then
  for PORTA in 80 443; do
    if ! executar iptables -C INPUT -p tcp --dport "$PORTA" -j ACCEPT 2>/dev/null; then
      executar iptables -I INPUT -p tcp --dport "$PORTA" -j ACCEPT
    fi
  done
  executar env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  if command -v netfilter-persistent >/dev/null 2>&1; then
    executar netfilter-persistent save >/dev/null 2>&1 || true
    echo "Regras de iptables salvas (sobrevivem ao reboot)."
  else
    aviso "Nao foi possivel persistir as regras de iptables; elas se perdem no proximo reboot."
  fi
fi

passo "Subindo os servicos"
executar docker compose up -d --build

passo "Agendando backup diario as 3h"
LINHA_CRON="0 3 * * * cd $DESTINO && ./scripts/backup.sh --docker \$(docker compose ps -q app) >> /var/log/prospecto-backup.log 2>&1"
( executar crontab -l 2>/dev/null | grep -v 'prospecto' ; echo "$LINHA_CRON" ) | executar crontab -

passo "Aguardando o certificado HTTPS"
HTTPS_OK=0
for i in $(seq 1 24); do
  if curl -fsS --max-time 5 "https://$DOMINIO/api/saude" >/dev/null 2>&1; then
    HTTPS_OK=1
    break
  fi
  sleep 5
done

echo
echo "=============================================================="
if [[ "$HTTPS_OK" == "1" ]]; then
  echo " Prospecto no ar: https://$DOMINIO"
else
  echo " Prospecto instalado, mas o HTTPS ainda nao respondeu."
  echo
  echo " Causas mais comuns, em ordem de frequencia:"
  echo "   1. As portas 80 e 443 nao foram liberadas no painel da nuvem."
  echo "      Na Oracle: Virtual Cloud Network > Security Lists > Add Ingress Rules."
  echo "      Isso NAO da para fazer de dentro da maquina."
  echo "   2. O DNS de $DOMINIO ainda nao propagou."
  echo "   3. O certificado ainda esta sendo emitido (aguarde ate 2 minutos)."
  echo
  echo " Acompanhe: docker compose -f $DESTINO/docker-compose.yml logs -f caddy"
fi

if [[ "$SENHA_NOVA" == "1" ]]; then
  echo
  echo " Senha de acesso: $(executar grep '^PROSPECTO_SENHA=' .env | cut -d= -f2-)"
  echo " Anote agora. Ela fica em $DESTINO/.env"
fi

cat <<FIM

 Comandos uteis:
   docker compose -f $DESTINO/docker-compose.yml logs -f
   docker compose -f $DESTINO/docker-compose.yml restart
   cd $DESTINO && git pull && docker compose up -d --build
==============================================================
FIM
