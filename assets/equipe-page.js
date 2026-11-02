/* ============================================================
   MBC - PAGES ÉQUIPE : moteur de rendu commun
   ------------------------------------------------------------
   Un seul fichier pour les sept pages. Chaque page WordPress ne
   contient qu'un conteneur et deux balises :

     <link rel="stylesheet" href="https://api.morieres-basket.club/assets/equipe-page.css">
     <div class="mbc-equipe"
          data-equipe="U13-1 Masculins"
          data-coachs="Nourdine"
          data-fiche="https://competitions.ffbb.com/...">
       <script type="application/json" class="mbc-contenu">
       { "staff": [...], "effectif": [...], "mot": ["..."] }
       </script>
     </div>
     <script src="https://api.morieres-basket.club/assets/equipe-page.js" defer></script>

   L'équipe est retrouvée par son NOM via /api/club, pas par un
   identifiant d'engagement : ces identifiants changent à chaque
   saison, et les pages survivent donc à l'été sans retouche.

   Le contenu éditorial (staff, effectif, mot du club) reste dans
   la page et non dans le dépôt : les prénoms des joueurs sont
   ceux de mineurs, ils n'ont pas à être versionnés dans un dépôt
   public. Le code est partagé, les personnes restent dans la page.
   ============================================================ */

(function () {
  "use strict";

  var BASE = "https://api.morieres-basket.club";
  var LOGO = "https://morieres-basket.club/wp-content/uploads/2025/04/morieres-bc.png";
  var MEDIAS = "https://morieres-basket.club/wp-content/uploads/2026/09/";
  var GYMNASE = "Gymnase Pierre Perdiguier, Morières-lès-Avignon";

  /* ---------- outils ---------- */

  function txt(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  }

  /* Les noms FFBB sont longs. Une ligne par adversaire suffit à
     traiter un nouveau club quand la poule change. */
  var RACCOURCIS = [
    { motif: /avignon\s*\/\s*pontet|^union sportive avignon/i, court: "USAP Avignon" },
    { motif: /arlesien|arlésien/i, court: "BC Arlésien" },
    { motif: /pays salonais|psb\s*13/i, court: "PSB 13" },
    { motif: /^ail de /i, court: "AIL Rousset" },
    { motif: /lasa/i, court: "LASA BC" },
    { motif: /sorgues/i, court: "Sorgues BC" },
    { motif: /carpentras/i, court: "Carpentras" },
    { motif: /cavaillon/i, court: "Cavaillon" },
    { motif: /chateaurenard|châteaurenard/i, court: "Châteaurenard" },
    { motif: /orange/i, court: "Orange BC" },
    { motif: /serignan|sérignan/i, court: "US Sérignan" },
    { motif: /rognonaise|rognonas/i, court: "USO Rognonaise" },
    { motif: /le thor|thor basket/i, court: "Le Thor" },
    { motif: /vedene|vedène/i, court: "Vedène" },
    { motif: /monteux/i, court: "Monteux" },
    { motif: /pernes|pernoise/i, court: "Pernes" }
  ];

  function nomCourt(nom) {
    if (!nom) return "";
    for (var i = 0; i < RACCOURCIS.length; i++) {
      if (RACCOURCIS[i].motif.test(nom)) return RACCOURCIS[i].court;
    }
    var paren = nom.match(/\(([^)]{2,18})\)/);
    var base = (paren ? paren[1] : nom).replace(/\s*-\s*\d+\s*$/, "").replace(/\s+/g, " ").trim();
    if (base.length > 24) {
      var mots = base.split(" "), out = "";
      for (var j = 0; j < mots.length; j++) {
        if ((out + " " + mots[j]).trim().length > 24) break;
        out = (out + " " + mots[j]).trim();
      }
      base = out || base.slice(0, 24);
    }
    return base;
  }

  function lieu(m) {
    if (m.domicile) return "Gymnase Perdiguier";
    var s = m.salle ? m.salle.replace(/\s+/g, " ").trim() : "";
    if (m.commune) return (s ? s + ", " : "") + m.commune;
    return s || "À confirmer";
  }

  /* Le flocage doit rétrécir avec la longueur du prénom, sinon SAMI
     flotte et ALEJANDRO déborde sur les bandes rouges du maillot.
     La contrainte n'est pas la largeur du maillot mais celle de la
     zone blanche, soit à peu près la largeur du mot MORIÈRES. */
  function palierFlocage(prenom) {
    var n = String(prenom || "").trim().length;
    if (n <= 4) return 1;
    if (n === 5) return 2;
    if (n === 6) return 3;
    if (n === 7) return 4;
    if (n === 8) return 5;
    if (n <= 10) return 6;
    return 7;
  }

  /* ---------- fragments ---------- */

  function etiquette(m) {
    if (m.miseEnAvant) {
      var cl = m.miseEnAvant.style === "or" ? "mbc-tag--derby" : "mbc-tag--affiche";
      return '<span class="mbc-tag ' + cl + '">' + txt(m.miseEnAvant.label) + "</span>";
    }
    return m.domicile
      ? '<span class="mbc-tag mbc-tag--dom">Domicile</span>'
      : '<span class="mbc-tag mbc-tag--ext">Extérieur</span>';
  }

  function ligneMatch(m) {
    var logo = m.logoAdversaire
      ? '<img class="mbc-ligne-logo" src="' + txt(m.logoAdversaire) + '" alt="" loading="lazy">'
      : "";
    var droite;
    if (m.joue && m.score) {
      droite = '<div class="mbc-ligne-score' + (m.resultat === "V" ? " v" : "") + '">' + txt(m.score.texte) + "</div>";
    } else if (m.enAttenteFeuille) {
      droite = '<div class="mbc-ligne-score attente">Feuille<br>en attente</div>';
    } else {
      droite = etiquette(m);
    }
    var d = m.date || {};
    return '<div class="mbc-ligne">' +
      '<div class="mbc-ligne-j">J' + txt(m.journee) + "</div>" +
      '<div class="mbc-ligne-d">' +
        '<div class="mbc-ligne-jour">' + txt(d.jour) + " " + txt(d.num) + "</div>" +
        '<div class="mbc-ligne-h">' + txt(d.heure) + "</div>" +
      "</div>" + logo +
      '<div class="mbc-ligne-c">' +
        '<div class="mbc-ligne-adv">' + txt(nomCourt(m.adversaire)) + "</div>" +
        '<div class="mbc-ligne-lieu">' + txt(lieu(m)) + "</div>" +
      "</div>" + droite +
    "</div>";
  }

  function ligneCal(m) {
    var sc = "-", cl = "";
    if (m.joue && m.score) { sc = m.score.texte; cl = m.resultat === "V" ? " v" : ""; }
    else if (m.enAttenteFeuille) { sc = "en attente"; }
    var d = m.date || {};
    return "<tr" + (m.domicile ? ' class="dom"' : "") + ">" +
      '<td class="mbc-cal-j">' + txt(m.journee) + "</td>" +
      "<td>" + txt(d.jour) + " " + txt(d.num) + " " + txt(d.mois) + " " + txt(d.heure) + "</td>" +
      '<td class="mbc-cal-adv">' + txt(nomCourt(m.adversaire)) + "</td>" +
      "<td>" + txt(m.domicile ? "Perdiguier" : (m.commune || "-")) + "</td>" +
      '<td class="mbc-cal-sc' + cl + '">' + txt(sc) + "</td>" +
    "</tr>";
  }

  function carte(l, v, s) {
    return '<div class="mbc-stat"><div class="mbc-stat-l">' + txt(l) + "</div>" +
      '<div class="mbc-stat-v">' + v + (s ? ' <small>' + txt(s) + "</small>" : "") + "</div></div>";
  }

  function attente(titre, detail, sticker) {
    return '<div class="mbc-attente">' +
      '<img class="mbc-sticker" src="' + txt(MEDIAS + (sticker || "sticker-perplexe.png")) +
        '" alt="La mascotte du club" loading="lazy">' +
      '<div class="mbc-attente-txt">' +
        '<div class="mbc-attente-t">' + txt(titre) + "</div>" +
        (detail ? "<p>" + txt(detail) + "</p>" : "") +
      "</div></div>";
  }

  function bloc(titre, accent, soustitre, corps, alt, sticker) {
    return '<section class="mbc-section' + (alt ? " mbc-section--alt" : "") + '">' +
      '<div class="mbc-wrap">' +
        '<div class="mbc-head">' +
          "<div>" +
            '<h2 class="mbc-titre">' + txt(titre) + ' <span>' + txt(accent) + "</span></h2>" +
            (soustitre ? '<p class="mbc-soustitre">' + txt(soustitre) + "</p>" : "") +
          "</div>" +
          (sticker ? '<img class="mbc-sticker-titre" src="' + txt(MEDIAS + sticker) +
            '" alt="" loading="lazy" aria-hidden="true">' : "") +
        "</div>" + corps +
      "</div></section>";
  }

  /* ---------- contenu éditorial de la page ---------- */

  function lireContenu(hote) {
    var noeud = hote.querySelector("script.mbc-contenu");
    if (!noeud) return {};
    try {
      return JSON.parse(noeud.textContent) || {};
    } catch (e) {
      /* Un JSON mal fermé ne doit pas emporter toute la page :
         on perd le staff et l'effectif, on garde les matchs. */
      if (window.console) console.warn("MBC : contenu de la page illisible, sections éditoriales ignorées", e);
      return {};
    }
  }

  function blocStaff(staff) {
    if (!staff || !staff.length) return "";
    var cartes = staff.map(function (c) {
      return '<div class="mbc-coach">' +
        '<div class="mbc-coach-n">' + txt(c.nom) + "</div>" +
        (c.role ? '<div class="mbc-coach-r">' + txt(c.role) + "</div>" : "") +
        (c.mot ? '<div class="mbc-coach-x">' + txt(c.mot) + "</div>" : "") +
      "</div>";
    }).join("");
    return bloc("Le", "staff", "Ceux qui sont au bord du terrain chaque week-end",
      '<div class="mbc-staff">' + cartes + "</div>");
  }

  function blocEffectif(effectif) {
    if (!effectif || !effectif.length) return "";
    var cartes = effectif.map(function (j, i) {
      var prenom = String(j.prenom || "").trim();
      var arc = "mbcArc" + (i + 1);
      var libre = !prenom;
      var floque = libre ? "" : prenom.toUpperCase();
      return '<div class="mbc-joueur' + (libre ? " mbc-joueur--libre" : "") + '">' +
        '<div class="mbc-maillot">' +
          '<img src="' + txt(MEDIAS + "maillot-mbc.png") + '" alt="" loading="lazy">' +
          '<svg class="mbc-flocage mbc-flocage--l' + palierFlocage(prenom) +
            '" viewBox="0 0 200 96" role="img" aria-label="' +
            txt(libre ? "Maillot Morières, place libre" : "Maillot Morières floqué " + prenom) + '">' +
            '<path id="' + arc + '" d="M 30 54 Q 100 16 170 54" fill="none"></path>' +
            '<text class="mbc-flocage-nom"><textPath href="#' + arc +
              '" startOffset="50%" text-anchor="middle">' + txt(floque) + "</textPath></text>" +
            '<text class="mbc-flocage-club" x="101" y="88" text-anchor="middle">MORIÈRES</text>' +
          "</svg>" +
        "</div>" +
        '<div class="mbc-joueur-p">' + txt(j.nom || prenom || "Place libre") + "</div>" +
        (j.categorie ? '<span class="mbc-joueur-poste">' + txt(j.categorie) + "</span>" : "") +
      "</div>";
    }).join("");

    var n = effectif.filter(function (j) { return j.prenom; }).length;
    var soustitre = n > 1 ? n + " joueurs floqués pour la saison"
                  : n === 1 ? "Un joueur floqué pour la saison"
                  : "Effectif en cours de constitution";
    return bloc("L'", "effectif", soustitre,
      '<div class="mbc-effectif">' + cartes + "</div>", true, "sticker-fier.png");
  }

  function blocMot(mot) {
    if (!mot) return "";
    var paras = (Array.isArray(mot) ? mot : [mot]).filter(Boolean);
    if (!paras.length) return "";
    return bloc("Le mot du", "club", "",
      '<div class="mbc-mot">' +
        paras.map(function (p) { return "<p>" + txt(p) + "</p>"; }).join("") +
        '<p class="mbc-mot-sig">Rédigé avec MBC Studio, relu par le bureau</p>' +
      "</div>");
  }

  function boutons(cfg) {
    return '<section class="mbc-section" style="padding-top:0;"><div class="mbc-wrap">' +
      '<div class="mbc-boutons">' +
      '<a href="https://www.youtube.com/channel/UC-tkswecO7QoVZBxdkS3qIQ" class="mbc-btn">' +
        '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Suivre les matchs</a>' +
      '<a href="https://morieres-basket.club/horaires" class="mbc-btn mbc-btn--ligne">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z"/></svg>' +
        "Horaires d'entraînement</a>" +
      '<a href="https://morieres-basket.club/inscription/" class="mbc-btn mbc-btn--ligne">Rejoindre l\'équipe</a>' +
      (cfg.fiche ? '<a href="' + txt(cfg.fiche) +
        '" class="mbc-btn mbc-btn--ligne" target="_blank" rel="noopener">Fiche FFBB</a>' : "") +
      "</div></div></section>";
  }

  /* ---------- rendu ---------- */

  function rendre(hote, cfg, eq, d, contenu) {
    var r = (d && d.resume) || {};
    var comp = (d && d.equipe && d.equipe.competition) || (eq && eq.competition) || "";
    var poule = (d && d.equipe && d.equipe.poule) || (eq && eq.poule) || "";

    /* --- bandeau --- */
    var html = '<header class="mbc-entete"><div class="mbc-wrap">' +
      '<div class="mbc-entete-haut">' +
        '<img src="' + txt(LOGO) + '" alt="Morières Basket Club">' +
        "<div><h1>" + txt(cfg.titre) + "</h1>" +
        '<p class="mbc-entete-comp">' + txt(comp + (poule ? " · " + poule : "")) + "</p></div>" +
        (d && d.saison ? '<span class="mbc-entete-saison">Saison ' + txt(d.saison) + "</span>" : "") +
      "</div>" +
      '<div class="mbc-entete-bas">' +
        (cfg.coachs ?
          "<span>" +
          '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 015 5v1h1a2 2 0 012 2v3a7 7 0 01-6 6.93V21h3v2H7v-2h3v-1.07A7 7 0 014 13v-3a2 2 0 012-2h1V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v1h6V7a3 3 0 00-3-3z"/></svg>' +
          txt(cfg.coachs) + "</span>" : "") +
        "<span>" +
        '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7zm0 4.5A2.5 2.5 0 1012 11.5 2.5 2.5 0 0012 6.5z"/></svg>' +
        txt(cfg.gymnase) + "</span>" +
      "</div></div></header>";

    /* --- indicateurs --- */
    var stats = "";
    if (!d) {
      stats = "";
    } else if (d.etat === "avant-saison") {
      stats += carte("Coup d'envoi", r.premierMatch ? txt(r.premierMatch.num + " " + r.premierMatch.mois) : "-");
      stats += carte("Équipes", txt(r.equipesDansLaPoule || "-"));
      stats += carte("Journées", txt(r.journees || "-"));
      stats += carte("À domicile", txt(r.aDomicile || "-"), "sur " + (r.journees || "-"));
    } else {
      var pos = r.position ? r.position + (r.position === 1 ? "er" : "e") : "-";
      stats += carte("Classement", txt(pos));
      stats += carte("Bilan", r.bilan ? txt(r.bilan.v) + "V " + txt(r.bilan.d) + "D" : "-");
      stats += carte("Journées", txt((r.joues || 0) + "/" + (r.journees || "-")));
      stats += carte("Série", r.serie
        ? (r.serie.type === "V" ? '<span class="vert">' + txt(r.serie.texte) + "</span>" : txt(r.serie.texte))
        : "-");
    }
    if (stats) {
      html += '<section class="mbc-section"><div class="mbc-wrap">' +
        '<div class="mbc-stats">' + stats + "</div></div></section>";
    }

    /* --- équipes sans compétition : U9, Loisirs, seconde équipe U11...
       Elles jouent en plateaux, la FFBB ne publie ni calendrier ni
       classement. Afficher "en attente" pour l'éternité serait faux :
       on explique, et on s'arrête là. --- */
    if (cfg.plateaux) {
      html += bloc("Comment ça se", "passe", "",
        attente("Pas de championnat pour cette équipe", cfg.plateaux, "sticker-bienvenue.png"));
      html += blocStaff(contenu.staff);
      html += blocEffectif(contenu.effectif);
      html += blocMot(contenu.mot);
      html += boutons(cfg);
      var racinePlateaux = el('<div class="mbc-root"></div>');
      racinePlateaux.innerHTML = html;
      hote.replaceChildren(racinePlateaux);
      return;
    }

    /* --- prochains matchs, ou derniers résultats en fin de saison --- */
    var aVenir = d && d.prochains && d.prochains.length;
    var liste = aVenir ? d.prochains.slice(0, 4) : ((d && d.derniers) || []).slice(0, 4);
    var corps = liste.length
      ? '<div class="mbc-liste">' + liste.map(ligneMatch).join("") + "</div>"
      : attente("Calendrier en attente de la FFBB",
          "Les rencontres s'afficheront ici dès que le comité les publiera.");
    html += bloc(aVenir || !liste.length ? "Prochains" : "Derniers",
      aVenir || !liste.length ? "matchs" : "résultats",
      aVenir || !liste.length
        ? "Calendrier officiel FFBB, mis à jour automatiquement"
        : "La phase est terminée, retrouvez le bilan ci-dessous",
      corps, false, "sticker-calendrier.png");

    /* --- calendrier complet --- */
    if (d && d.calendrier && d.calendrier.length) {
      html += bloc("Toute la", "saison", "Les réceptions à Perdiguier sont surlignées",
        '<div class="mbc-cal-wrap"><div class="mbc-cal-scroll">' +
        '<table class="mbc-cal"><thead><tr>' +
          "<th>J</th><th>Date</th><th>Adversaire</th><th>Lieu</th>" +
          '<th style="text-align:right">Score</th>' +
        "</tr></thead><tbody>" + d.calendrier.map(ligneCal).join("") +
        "</tbody></table></div></div>");
    }

    /* --- classement --- */
    var corpsC;
    if (d && d.classement && d.classement.length) {
      corpsC = '<div class="mbc-cal-wrap"><div class="mbc-cal-scroll">' +
        '<table class="mbc-classement"><thead><tr>' +
          "<th>#</th><th>Équipe</th><th>J</th><th>V</th><th>D</th><th>Pts</th>" +
        "</tr></thead><tbody>" +
        d.classement.map(function (c) {
          return "<tr" + (c.nous ? ' class="nous"' : "") + ">" +
            "<td>" + txt(c.position) + "</td>" +
            "<td>" + txt(nomCourt(c.equipe)) + "</td>" +
            "<td>" + txt(c.joues) + "</td>" +
            "<td>" + txt(c.gagnes) + "</td>" +
            "<td>" + txt(c.perdus) + "</td>" +
            "<td>" + txt(c.points) + "</td>" +
          "</tr>";
        }).join("") +
        "</tbody></table></div></div>" +
        '<p class="mbc-maj">Source FFBB, mise à jour automatique après chaque journée</p>';
    } else {
      corpsC = attente("Classement disponible après la première journée",
        "Il apparaîtra ici dès que la FFBB le publiera.");
    }
    html += bloc("Classement de la", "poule", "Source FFBB", corpsC, true);

    /* --- sections éditoriales de la page --- */
    html += blocStaff(contenu.staff);
    html += blocEffectif(contenu.effectif);
    html += blocMot(contenu.mot);

    /* --- boutons --- */
    html += boutons(cfg);

    var racine = el('<div class="mbc-root"></div>');
    racine.innerHTML = html;
    hote.replaceChildren(racine);
  }

  /* ---------- démarrage ---------- */

  function json(url) {
    return fetch(url).then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status + " sur " + url));
    });
  }

  /* On retrouve l'équipe par son libellé, insensible aux accents et
     à la casse, pour ne pas dépendre d'identifiants qui changent
     chaque saison. "U13-1" suffit si le libellé complet est
     "U13-1 Masculins". */
  function normaliser(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function trouverEquipe(equipes, voulue) {
    var cible = normaliser(voulue);
    if (!cible) return null;
    var exact = equipes.filter(function (e) { return normaliser(e.libelle) === cible; });
    if (exact.length) return exact[0];
    var partiel = equipes.filter(function (e) { return normaliser(e.libelle).indexOf(cible) === 0; });
    return partiel.length === 1 ? partiel[0] : null;
  }

  function demarrer(hote) {
    var cfg = {
      titre: hote.getAttribute("data-titre") || hote.getAttribute("data-equipe") || "",
      equipe: hote.getAttribute("data-equipe") || "",
      coachs: hote.getAttribute("data-coachs") || "",
      gymnase: hote.getAttribute("data-gymnase") || GYMNASE,
      fiche: hote.getAttribute("data-fiche") || "",
      /* Présent = équipe sans championnat FFBB. La valeur est la phrase
         affichée aux parents pour expliquer les plateaux. */
      plateaux: hote.getAttribute("data-plateaux") || ""
    };
    var contenu = lireContenu(hote);

    /* Sans compétition, rien à demander à la FFBB : on rend tout de suite. */
    if (cfg.plateaux) {
      if (!cfg.titre) cfg.titre = cfg.equipe;
      rendre(hote, cfg, null, null, contenu);
      return;
    }

    if (!cfg.equipe) {
      if (window.console) console.warn("MBC : data-equipe manquant sur le conteneur");
      return;
    }

    json(BASE + "/api/club")
      .then(function (club) {
        var equipes = (club && club.equipes) || [];
        var eq = trouverEquipe(equipes, cfg.equipe);
        if (!eq) {
          throw new Error('équipe "' + cfg.equipe + '" absente de /api/club (' +
            equipes.map(function (e) { return e.libelle; }).join(", ") + ")");
        }
        /* Pas de championnat publié : on affiche la coupe plutôt que rien. */
        var id = eq.enChampionnat === false && eq.coupe ? eq.coupe.id : eq.id;
        return json(BASE + "/api/equipe?id=" + encodeURIComponent(id))
          .then(function (d) { return { eq: eq, d: d, saison: club.saison }; });
      })
      .then(function (res) {
        res.d.saison = res.d.saison || res.saison;
        rendre(hote, cfg, res.eq, res.d, contenu);
      })
      .catch(function (e) {
        if (window.console) console.warn("MBC : données FFBB indisponibles", e);
        /* Le bandeau, le staff et l'effectif ne dépendent pas de la
           FFBB : on affiche la page sans les matchs plutôt qu'une
           page vide. */
        try { rendre(hote, cfg, null, null, contenu); }
        catch (e2) { if (window.console) console.warn("MBC : rendu de secours impossible", e2); }
      });
  }

  function lancer() {
    var hotes = document.querySelectorAll(".mbc-equipe");
    for (var i = 0; i < hotes.length; i++) demarrer(hotes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", lancer);
  } else {
    lancer();
  }
})();
