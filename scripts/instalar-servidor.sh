#!/usr/bin/env bash
#
# Instala o Prospecto num servidor Ubuntu/Debian limpo.
#
# Pensado para uma VM gratuita (Oracle Cloud Always Free) ou qualquer VPS.
# Instala Docker, configura o firewall, gera os segredos e sobe o servico com
# HTTPS automatico.
#
# Uso, no servidor, como root ou com sudo:
#   curl -fsSL https://raw.githubusercontent.com/LuisGuilherme605/Teste/main/scripts/instalar-servidor.sh | bash -s -- prospecto.seudominio.com.br voce@email.com

set -euo pipefail

DOMINIO="${1:-}"
EMAIL="${2:-}"
REPO="${PROSPECTO_REPO:-https://github.com/LuisGuilherme605/Teste.git}"
DESTINO="${PROSPECTO_DIR:-/opt/prospecto}"

if [[ -z "$DOMINIO" || -z "$EMAIL" ]]; then
  echo "Uso: $0 <dominio> <email>" >&2
  echo "Exemplo: $0 prospecto.minhaempresa.com.br luis@minhaempresa.com.br" >&2
  exit 1
fi

executar() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi; }

echo "==> Instalando dependencias"
executar apt-get update -qq
executar apt-get install -y -qq ca-certificates curl git openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker"
  curl -fsSL https://get.docker.com | executar sh
  executar systemctl enable --now docker
fi

echo "==> Baixando o projeto em $DESTINO"
if [[ -d "$DESTINO/.git" ]]; then
  executar git -C "$DESTINO" pull --ff-only
else
  executar git clone --depth 1 "$REPO" "$DESTINO"
fi

cd "$DESTINO"

if [[ ! -f .env ]]; then
  echo "==> Gerando .env com segredos aleatorios"
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
fi

echo "==> Configurando o firewall"
if command -v ufw >/dev/null 2>&1; then
  executar ufw allow 22/tcp  >/dev/null
  executar ufw allow 80/tcp  >/dev/null
  executar ufw allow 443/tcp >/dev/null
  executar ufw --force enable >/dev/null
fi
# Em VMs da Oracle e da AWS o iptables vem com DROP padrao, e so o ufw nao basta.
if command -v iptables >/dev/null 2>&1; then
  executar iptables -I INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
  executar iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
  command -v netfilter-persistent >/dev/null 2>&1 && executar netfilter-persistent save >/dev/null 2>&1 || true
fi

echo "==> Subindo os servicos"
executar docker compose up -d --build

echo "==> Agendando backup diario as 3h"
LINHA_CRON="0 3 * * * cd $DESTINO && ./scripts/backup.sh --docker \$(docker compose ps -q app) >> /var/log/prospecto-backup.log 2>&1"
( executar crontab -l 2>/dev/null | grep -v 'prospecto/scripts/backup.sh' ; echo "$LINHA_CRON" ) | executar crontab -

echo
echo "=============================================================="
echo " Prospecto instalado."
echo
echo " Endereco: https://$DOMINIO"
if [[ "${SENHA_NOVA:-0}" == "1" ]]; then
  echo " Senha:    $(executar grep '^PROSPECTO_SENHA=' .env | cut -d= -f2-)"
  echo
  echo " Anote a senha agora. Ela fica em $DESTINO/.env"
fi
echo
echo " O certificado HTTPS leva ate 1 minuto para ser emitido."
echo " Confira se o DNS de $DOMINIO aponta para o IP deste servidor."
echo
echo " Logs:      docker compose -f $DESTINO/docker-compose.yml logs -f"
echo " Reiniciar: docker compose -f $DESTINO/docker-compose.yml restart"
echo "=============================================================="
