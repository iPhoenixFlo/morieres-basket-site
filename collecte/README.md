# Collecteur FFBB

## Pourquoi ce dossier existe

Depuis le 19 octobre 2026, le pare-feu de la FFBB refuse les requêtes venant
des hébergeurs. Vercel ne peut donc plus interroger la fédération : les
quatre origines connues répondent 403. Les mêmes requêtes passent sans
problème depuis une connexion ordinaire.

La collecte a donc été sortie de l'hébergeur. Ce script tourne sur une
machine à connexion résidentielle, dépose les données sur le site, et le
site ne lit plus que ça. Il ne contacte plus la FFBB du tout.

Le script ne recopie aucune logique métier : il réutilise les fichiers
`api/club.js` et `api/equipe.js` du site en les basculant en mode direct.
Une correction faite pour le site profite donc au collecteur sans
duplication.

## Installation, une seule fois

### 1. Créer la table

Dans l'éditeur SQL de Supabase, exécuter `sql/schema-ffbb.sql`.
Le retour attendu est « Success. No rows returned ».

### 2. Poser la clé de dépôt sur Vercel

Dans les variables d'environnement du projet, ajouter :

```
FFBB_INGEST_CLE = <la clé>
```

Puis redéployer, sinon la variable n'est pas prise en compte.

### 3. Préparer le script en local

```bash
cd ~/morieres-basket-site/collecte
cp .env.exemple .env
# renseigner FFBB_INGEST_CLE avec la même valeur que sur Vercel
```

### 4. Essayer sans rien déposer

```bash
node collecte-ffbb.mjs --essai
```

Le résultat attendu ressemble à :

```
[...] lecture des engagements du club
[...] 7 équipe(s), 6 en coupe
[...]   Séniors Masculins      14 rencontre(s)
[...]   U18 Masculins          18 rencontre(s)
...
[...] essai : 13 entrée(s) prêtes, rien n'a été déposé
```

Si cette étape renvoie un 403, le pare-feu bloque aussi cette connexion :
essayer depuis un autre réseau, ou attendre quelques heures.

### 5. Déposer pour de vrai

```bash
node collecte-ffbb.mjs
```

Puis vérifier l'état en ouvrant `https://api.morieres-basket.club/api/ingest`.
On attend `"etat": "complet"` et `"manquants": 0`.

### 6. Automatiser toutes les 3 heures

```bash
cd ~/morieres-basket-site/collecte
sed -i '' "s|REMPLACER_CHEMIN|$(pwd)|g" club.morieres.collecte-ffbb.plist
cp club.morieres.collecte-ffbb.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/club.morieres.collecte-ffbb.plist
```

Sur un portable, le planificateur rattrape au réveil une exécution tombée
pendant la veille. Une nuit capot fermé ne fait donc pas perdre la mise à
jour du lendemain.

## Au quotidien

Rien à faire. Pour regarder ce qui s'est passé :

```bash
tail -30 ~/morieres-basket-site/collecte/collecte.log
```

Lancer une collecte tout de suite, par exemple juste après les matchs :

```bash
launchctl kickstart -k gui/$(id -u)/club.morieres.collecte-ffbb
```

Arrêter l'automatisation :

```bash
launchctl unload ~/Library/LaunchAgents/club.morieres.collecte-ffbb.plist
```

## Codes de sortie

| Code | Signification |
|---|---|
| 0 | Collecte complète et déposée |
| 1 | Échec global : FFBB injoignable, clé absente, dépôt refusé |
| 2 | Déposé, mais au moins une équipe n'a pas pu être collectée |

## Si la FFBB redevient accessible aux hébergeurs

Rien à défaire. Il suffit de poser `FFBB_MODE=direct` dans les variables
Vercel : les fonctions recommencent à interroger la fédération elles-mêmes,
et le collecteur devient inutile sans avoir à toucher au code.
