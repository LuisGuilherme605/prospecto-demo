#!/usr/bin/env bash
#
# Backup do banco do Prospecto.
#
# Usa o comando `.backup` do SQLite em vez de copiar o arquivo. A diferenca
# importa: copiar um SQLite com escrita em andamento produz um arquivo corrompido
# que so se descobre no dia em que precisar restaurar. O `.backup` faz uma copia
# consistente com o banco em uso.
#
# Uso:
#   ./scripts/backup.sh                          # backup local
#   ./scripts/backup.sh --docker prospecto-app-1 # backup de dentro do container
#
# Agende no cron do servidor (todo dia as 3h):
#   0 3 * * * /caminho/para/prospecto/scripts/backup.sh >> /var/log/prospecto-backup.log 2>&1

set -euo pipefail

DESTINO="${PROSPECTO_BACKUPS:-./backups}"
BANCO="${PROSPECTO_BANCO:-data/prospecto.db}"
MANTER_DIAS="${PROSPECTO_BACKUP_DIAS:-30}"
CONTAINER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) CONTAINER="${2:-}"; shift 2 ;;
    --destino) DESTINO="${2:-}"; shift 2 ;;
    --banco) BANCO="${2:-}"; shift 2 ;;
    *) echo "Opcao desconhecida: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$DESTINO"
CARIMBO=$(date +%Y-%m-%d_%H%M%S)
ARQUIVO="$DESTINO/prospecto_$CARIMBO.db"

if [[ -n "$CONTAINER" ]]; then
  # Dentro do container o banco fica em /dados; a copia sai consistente de la e
  # e trazida para o host.
  docker exec "$CONTAINER" node --experimental-sqlite -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.PROSPECTO_BANCO || '/dados/prospecto.db');
    db.exec(\"VACUUM INTO '/tmp/backup.db'\");
    db.close();
  "
  docker cp "$CONTAINER:/tmp/backup.db" "$ARQUIVO"
  docker exec "$CONTAINER" rm -f /tmp/backup.db
else
  [[ -f "$BANCO" ]] || { echo "Banco nao encontrado: $BANCO" >&2; exit 1; }
  # VACUUM INTO produz copia consistente e ja compactada, sem travar escritas.
  node --experimental-sqlite -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('$BANCO');
    db.exec(\"VACUUM INTO '$ARQUIVO'\");
    db.close();
  "
fi

gzip -f "$ARQUIVO"
echo "Backup salvo: ${ARQUIVO}.gz ($(du -h "${ARQUIVO}.gz" | cut -f1))"

# Remove os antigos. Sem isso, o disco enche silenciosamente e o app para de
# escrever -- um jeito ruim de descobrir que havia backup automatico.
APAGADOS=$(find "$DESTINO" -name 'prospecto_*.db.gz' -mtime "+$MANTER_DIAS" -print -delete | wc -l)
[[ "$APAGADOS" -gt 0 ]] && echo "Removidos $APAGADOS backups com mais de $MANTER_DIAS dias."

echo "Backups guardados: $(find "$DESTINO" -name 'prospecto_*.db.gz' | wc -l)"
