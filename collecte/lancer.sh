#!/bin/bash
# ---------------------------------------------------------------
# Lanceur du collecteur FFBB.
#
# Le planificateur de macOS (launchd) démarre les tâches avec un
# environnement minimal : ni ton PATH, ni les réglages de ton shell.
# Node est donc introuvable si on ne va pas le chercher. Ce script s'en
# occupe, journalise, et renvoie un code de sortie exploitable.
# ---------------------------------------------------------------

set -u

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOURNAL="$ICI/collecte.log"

# On garde le journal lisible : au-delà de 2 Mo, on repart d'une page neuve
# en conservant la précédente.
if [ -f "$JOURNAL" ] && [ "$(wc -c < "$JOURNAL")" -gt 2000000 ]; then
  mv -f "$JOURNAL" "$JOURNAL.1"
fi

dire() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$JOURNAL"; }

# Emplacements habituels de Node, du plus probable au moins probable sur
# un Mac Apple Silicon.
NODE=""
for candidat in \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.volta/bin/node" \
  "$HOME/.nvm/versions/node/current/bin/node" \
  "$(command -v node 2>/dev/null)"
do
  if [ -n "$candidat" ] && [ -x "$candidat" ]; then NODE="$candidat"; break; fi
done

# Dernier recours : la version active de nvm, dont le chemin contient le
# numéro de version et ne peut donc pas être devinée.
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE="$(find "$HOME/.nvm/versions/node" -maxdepth 2 -name node -type f -perm -u+x 2>/dev/null | sort -V | tail -1)"
fi

if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  dire "ECHEC : Node introuvable. Installer Node, ou renseigner son chemin dans ce script."
  exit 1
fi

dire "démarrage ($("$NODE" --version 2>/dev/null))"
"$NODE" "$ICI/collecte-ffbb.mjs" "$@" >> "$JOURNAL" 2>&1
CODE=$?

case "$CODE" in
  0) dire "terminé sans erreur" ;;
  2) dire "terminé avec des équipes manquantes" ;;
  *) dire "terminé en échec (code $CODE)" ;;
esac

exit "$CODE"
