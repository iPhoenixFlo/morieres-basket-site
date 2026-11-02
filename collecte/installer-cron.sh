#!/bin/bash
# ---------------------------------------------------------------
# Installe la collecte FFBB toutes les 3 heures, sur Linux.
#
# Équivalent du LaunchAgent macOS, en cron. Le script est idempotent :
# le relancer ne crée pas de doublon, il remplace la ligne existante.
#
#   bash installer-cron.sh            installe ou met à jour
#   bash installer-cron.sh --retirer  désinstalle
# ---------------------------------------------------------------

set -u

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARQUEUR="# collecte-ffbb-mbc"
LIGNE="0 */3 * * * /bin/bash $ICI/lancer.sh >/dev/null 2>&1 $MARQUEUR"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab est absent de cette machine."
  echo "Sur Debian ou Ubuntu : sudo apt install cron && sudo systemctl enable --now cron"
  exit 1
fi

# La table courante, en ignorant les messages de cron quand elle est vide.
actuelle="$(crontab -l 2>/dev/null || true)"
# On retire toujours l'ancienne ligne : c'est ce qui rend l'opération rejouable.
nettoyee="$(printf '%s\n' "$actuelle" | grep -vF "$MARQUEUR" || true)"

if [ "${1:-}" = "--retirer" ]; then
  printf '%s\n' "$nettoyee" | grep -v '^$' | crontab -
  echo "Collecte automatique retirée."
  echo "Les données déjà déposées restent en ligne, elles ne seront simplement plus rafraîchies."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node est introuvable. À installer avant d'automatiser :"
  echo "  Debian / Ubuntu : sudo apt install nodejs"
  echo "  ou, pour une version récente : https://nodejs.org"
  exit 1
fi

if [ ! -f "$ICI/.env" ]; then
  echo "Le fichier .env est absent de $ICI"
  echo "Le créer à partir de .env.exemple et y mettre la clé de dépôt."
  exit 1
fi

{ printf '%s\n' "$nettoyee" | grep -v '^$'; printf '%s\n' "$LIGNE"; } | crontab -

echo "Collecte automatique installée : toutes les 3 heures, à l'heure pile."
echo "Node    : $(node --version)"
echo "Journal : $ICI/collecte.log"
echo
echo "Pour vérifier     : crontab -l"
echo "Pour lancer tout de suite : bash $ICI/lancer.sh"
echo "Pour désinstaller : bash $ICI/installer-cron.sh --retirer"
