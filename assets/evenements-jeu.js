/* ============================================================
   MBC - ÉVÉNEMENTS DU JEU
   ------------------------------------------------------------
   Affiche un bandeau « en ce moment » dans le bloc du jeu de la
   page d'accueil, quand une nouveauté temporaire est en cours :
   un ballon citrouille à Halloween, un terrain enneigé à Noël...

   Tout l'intérêt est là : le bandeau S'ÉTEINT TOUT SEUL à la
   date de fin. Personne n'a à repenser à le retirer, et la page
   d'accueil ne peut pas annoncer un événement terminé.

   Ajouter un événement = ajouter une ligne ci-dessous et
   pousser. Aucune page WordPress à retoucher.
   ============================================================ */

(function () {
  "use strict";

  /* Dates au format AAAA-MM-JJ, bornes incluses : un événement qui
     finit le 03 reste affiché toute la journée du 3. */
  var EVENEMENTS = [
    {
      debut: "2026-10-24",
      fin: "2026-11-10",
      titre: "Spécial Halloween",
      texte: "Ballon citrouille et terrain hanté à débloquer",
      accent: "#E87A2E"
    }
    /* Exemples pour la suite, à décommenter et ajuster le moment venu :
    { debut: "2026-12-15", fin: "2027-01-04",
      titre: "Spécial Noël", texte: "Terrain enneigé et ballon doré",
      accent: "#C9A227" },
    */
  ];

  function jour(texte, finDeJournee) {
    var p = String(texte || "").split("-");
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return null;
    if (finDeJournee) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }

  function enCours() {
    var maintenant = new Date();
    for (var i = 0; i < EVENEMENTS.length; i++) {
      var e = EVENEMENTS[i];
      var d = jour(e.debut, false);
      var f = jour(e.fin, true);
      if (d && f && maintenant >= d && maintenant <= f) return e;
    }
    return null;
  }

  /* "dernier jour" vaut mieux que "encore 1 jour" : c'est ce qui fait
     cliquer. On compare des dates de calendrier, pas des millisecondes,
     pour ne pas se tromper d'un jour selon l'heure. */
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
              "août", "septembre", "octobre", "novembre", "décembre"];

  function echeance(fin) {
    var f = jour(fin, false);
    if (!f) return "";
    var aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    var jours = Math.round((f - aujourdhui) / 86400000);
    if (jours <= 0) return "dernier jour";
    if (jours === 1) return "jusqu'à demain";
    if (jours <= 6) return "encore " + jours + " jours";
    /* Au-delà d'une semaine, un décompte ne parle plus : on donne la
       date, qui reste une information utile. */
    var n = f.getDate();
    return "jusqu'au " + (n === 1 ? "1er" : n) + " " + MOIS[f.getMonth()];
  }

  function styles() {
    if (document.getElementById("mbcjeu-evt-style")) return;
    var s = document.createElement("style");
    s.id = "mbcjeu-evt-style";
    s.textContent = [
      ".mbcjeu-evt{",
      "  display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;",
      "  margin:30px 0 0;padding:14px 20px;border-radius:10px;",
      "  background:rgba(255,255,255,.07);",
      "  border:1px solid rgba(255,255,255,.18);",
      "  border-left:4px solid var(--mbcjeu-accent,#E87A2E);",
      "  font-size:14.5px;line-height:1.35;color:rgba(255,255,255,.92);",
      "}",
      ".mbcjeu-evt b{",
      "  font-family:'Barlow Condensed',sans-serif;font-weight:900;",
      "  text-transform:uppercase;letter-spacing:.06em;font-size:15px;",
      "  color:var(--mbcjeu-accent,#E87A2E);",
      "}",
      ".mbcjeu-evt i{",
      "  font-style:normal;font-family:'Barlow Condensed',sans-serif;",
      "  font-weight:900;text-transform:uppercase;letter-spacing:.08em;",
      "  font-size:11.5px;padding:3px 9px;border-radius:100px;",
      "  background:var(--mbcjeu-accent,#E87A2E);color:#17181A;",
      "}",
      "@media (max-width:520px){.mbcjeu-evt{font-size:13.5px;}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function texte(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function lancer() {
    var hote = document.querySelector(".mbcjeu-txt");
    if (!hote) return;                                  // bloc du jeu absent
    if (hote.querySelector(".mbcjeu-evt")) return;      // déjà posé
    var e = enCours();
    if (!e) return;                                     // rien en cours

    styles();
    var p = document.createElement("p");
    p.className = "mbcjeu-evt";
    if (e.accent) p.style.setProperty("--mbcjeu-accent", e.accent);
    var fin = echeance(e.fin);
    p.innerHTML =
      "<b>" + texte(e.titre) + "</b>" +
      "<span>" + texte(e.texte) + "</span>" +
      (fin ? "<i>" + texte(fin) + "</i>" : "");

    /* Juste sous le paragraphe de présentation, avant les pastilles. */
    var points = hote.querySelector(".mbcjeu-points");
    if (points) hote.insertBefore(p, points);
    else hote.appendChild(p);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", lancer);
  } else {
    lancer();
  }
})();
