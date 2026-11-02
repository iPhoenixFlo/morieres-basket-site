# Pages équipe : un moteur, dix pages

## Le principe

Avant, chaque page équipe contenait 900 lignes de HTML, de CSS et de
JavaScript, collées dans un widget Elementor. Sept pages à créer, c'était
sept copies à maintenir, et la moindre correction se payait sept fois.

Désormais le code vit dans le dépôt, servi en fichier statique (donc sans
consommer aucune des 12 fonctions Vercel), et chaque page WordPress ne
contient plus qu'un conteneur et son contenu éditorial. Une correction ici
se répercute sur les dix pages au prochain commit.

Deux choses restent volontairement dans la page WordPress :

- **Le staff, l'effectif et le mot du club.** Les prénoms sont ceux de
  mineurs : ils n'ont pas à être versionnés dans un dépôt public. Le code
  est partagé, les personnes restent dans la page.
- **Le nom de l'équipe et les coachs**, qui changent d'une page à l'autre.

## L'équipe est retrouvée par son nom, pas par un identifiant

L'ancienne page U18 portait `ID = '200000005350777'` en dur. Ces
identifiants d'engagement changent **à chaque saison** : il aurait fallu
rouvrir les dix pages chaque été.

Le moteur interroge `/api/club` et retrouve l'équipe par son libellé,
insensible à la casse et aux accents. `data-equipe="u13-1"` suffit.
Si le championnat n'est pas encore publié, il bascule tout seul sur
l'engagement en coupe.

## Le squelette d'une page

```html
<link rel="stylesheet" href="https://api.morieres-basket.club/assets/equipe-page.css">

<div class="mbc-equipe"
     data-equipe="U13-1 Masculins"
     data-coachs="Nourdine"
     data-fiche="https://competitions.ffbb.com/...">
  <script type="application/json" class="mbc-contenu">
  {
    "staff": [
      { "nom": "Nourdine", "role": "Coach principal", "mot": "Également coach des U18." }
    ],
    "effectif": [
      { "prenom": "Sami", "nom": "Sami E.", "categorie": "U13" },
      { "prenom": "", "nom": "", "categorie": "" }
    ],
    "mot": [
      "Premier paragraphe.",
      "Deuxième paragraphe."
    ]
  }
  </script>
</div>

<script src="https://api.morieres-basket.club/assets/equipe-page.js" defer></script>
```

### Les attributs

| Attribut | Rôle |
|---|---|
| `data-equipe` | **Obligatoire.** Le libellé de l'équipe tel que `/api/club` le renvoie |
| `data-titre` | Titre affiché, si différent du libellé |
| `data-coachs` | Texte libre, affiché sous le titre |
| `data-gymnase` | Par défaut : Gymnase Pierre Perdiguier, Morières-lès-Avignon |
| `data-fiche` | Lien vers la fiche FFBB. Omis, le bouton disparaît |
| `data-plateaux` | Pour une équipe **sans championnat**. La valeur est la phrase affichée aux parents |

### Le bloc de contenu

Les trois clés sont facultatives : une section absente n'est tout
simplement pas affichée.

- `staff` : `nom`, `role`, `mot`
- `effectif` : `prenom` (floqué sur le maillot, en majuscules
  automatiquement), `nom` (affiché sous la carte, prénom + initiale),
  `categorie` (la pastille, qui rend les surclassements visibles). Un
  `prenom` vide produit une carte « place libre » grisée.
- `mot` : un tableau de paragraphes. La signature est ajoutée toute seule.

Un JSON mal fermé ne casse pas la page : les sections éditoriales sont
ignorées, les matchs restent affichés, et un avertissement part dans la
console du navigateur.

## Les dix pages

Sept équipes sont engagées en compétition, trois jouent en plateaux.

| Page | `data-equipe` | Coachs | Remarque |
|---|---|---|---|
| `/equipes/u18` | `U18 Masculins` | Nono et Pierro | Page existante, à migrer |
| `/equipes/seniors` | `Séniors Masculins` | Jérôme | Page existante, à migrer |
| `/equipes/u15-1` | `U15-1 Masculins` | Ahmed | |
| `/equipes/u15-2` | `U15-2 Masculins` | à confirmer | |
| `/equipes/u13-1` | `U13-1 Masculins` | Nourdine | |
| `/equipes/u13-2` | `U13-2 Masculins` | Renaud | |
| `/equipes/u11-1` | `U11 Masculins` | Alexandre et Colin | Seule équipe U11 engagée |
| `/equipes/u11-2` | — | Nassera | `data-plateaux` |
| `/equipes/u9` | — | Nassera et Stéphanie | `data-plateaux` |
| `/equipes/loisirs` | — | — | `data-plateaux` |

### Exemple d'équipe en plateaux

```html
<link rel="stylesheet" href="https://api.morieres-basket.club/assets/equipe-page.css">

<div class="mbc-equipe"
     data-equipe="U9 Masculins"
     data-coachs="Nassera et Stéphanie"
     data-plateaux="Les U9 jouent en plateaux le samedi matin : plusieurs équipes réunies sur un même gymnase, des matchs courts, et aucun classement. L'important à cet âge, c'est de jouer beaucoup.">
  <script type="application/json" class="mbc-contenu">
  { "staff": [ { "nom": "Nassera", "role": "Coach" } ] }
  </script>
</div>

<script src="https://api.morieres-basket.club/assets/equipe-page.js" defer></script>
```

Aucun appel n'est fait à la FFBB dans ce mode : ni indicateurs, ni
calendrier, ni classement, et surtout pas de « calendrier en attente »
qui resterait affiché toute la saison.

## En cas de souci

Ouvrir la console du navigateur. Le moteur n'échoue jamais en silence :

| Message | Cause |
|---|---|
| `data-equipe manquant sur le conteneur` | L'attribut n'est pas renseigné |
| `équipe "..." absente de /api/club (...)` | Le libellé ne correspond pas. Le message liste les libellés disponibles |
| `contenu de la page illisible` | JSON mal formé dans le bloc |
| `données FFBB indisponibles` | L'API ne répond pas. La page s'affiche sans les matchs |

Si l'API ne répond pas, vérifier d'abord que la collecte tourne :
`https://api.morieres-basket.club/api/ingest` doit indiquer
`"etat":"complet"`. Voir `collecte/README.md`.
