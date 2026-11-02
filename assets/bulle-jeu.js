/* ============================================================
   MBC - BULLE D'ACCÈS AU JEU
   ------------------------------------------------------------
   Une pastille discrète en bas à droite, présente sur tout le
   site, qui mène à MBC Shootout.

   À ajouter une seule fois dans le bloc header, puisque celui-ci
   est présent sur toutes les pages :

     <script src="https://api.morieres-basket.club/assets/bulle-jeu.js" defer></script>

   Ce n'est volontairement pas un pop-up : rien ne barre la route
   au visiteur venu chercher un horaire ou une inscription. Qui
   ferme la pastille ne la revoit plus.
   ============================================================ */

(function () {
  "use strict";

  /* Changer cette adresse le jour où le jeu déménage sur
     jeu.morieres-basket.club : c'est le seul endroit à toucher. */
  var JEU = "https://iphoenixflo.github.io/mbc-jam/shootout.html";
  var MASCOTTE = "https://morieres-basket.club/wp-content/uploads/2026/09/sticker-fier.png";
  var MEMOIRE = "mbc-bulle-jeu-fermee";
  var DELAI = 1200;   // laisse la page s'afficher avant d'apparaître

  /* Pages où la bulle n'a rien à faire : un parent en train de remplir
     une inscription ou de payer un stage n'a pas besoin qu'on lui
     propose un jeu au même moment. */
  var EXCLUES = ["/inscription", "/stages", "/avis-stage", "/paiement"];

  function pageExclue() {
    var chemin = (location.pathname || "").toLowerCase();
    for (var i = 0; i < EXCLUES.length; i++) {
      if (chemin.indexOf(EXCLUES[i]) === 0 || chemin.indexOf(EXCLUES[i] + "/") > -1) return true;
    }
    return false;
  }

  /* localStorage peut lever une exception en navigation privée ou
     quand les données de site sont bloquées. On n'empêche jamais la
     bulle de s'afficher pour autant. */
  function dejaFermee() {
    try { return window.localStorage.getItem(MEMOIRE) === "1"; }
    catch (e) { return false; }
  }
  function memoriser() {
    try { window.localStorage.setItem(MEMOIRE, "1"); } catch (e) { /* tant pis */ }
  }

  function styles() {
    if (document.getElementById("mbc-bulle-style")) return;
    var s = document.createElement("style");
    s.id = "mbc-bulle-style";
    s.textContent = [
      ".mbc-bulle{",
      "  position:fixed;z-index:9000;",
      "  right:16px;bottom:16px;",
      /* iOS : on évite la barre de gestes */
      "  bottom:calc(16px + env(safe-area-inset-bottom,0px));",
      "  display:flex;align-items:center;gap:10px;",
      "  padding:8px 18px 8px 8px;border-radius:100px;",
      "  background:#BA2A2F;color:#fff;text-decoration:none;",
      "  box-shadow:0 8px 24px rgba(0,0,0,.28);",
      "  font-family:'Barlow Condensed','Barlow',system-ui,sans-serif;",
      "  font-weight:900;text-transform:uppercase;letter-spacing:.06em;",
      "  font-size:16px;line-height:1;",
      "  opacity:0;transform:translateY(14px);",
      "  transition:opacity .35s ease,transform .35s ease,background .18s;",
      "}",
      ".mbc-bulle--visible{opacity:1;transform:none;}",
      ".mbc-bulle:hover,.mbc-bulle:focus-visible{background:#8E1F23;color:#fff;}",
      ".mbc-bulle:focus-visible{outline:3px solid #fff;outline-offset:3px;}",
      /* Le thème WordPress impose un height:auto sur les images :
         les !important sont indispensables ici. */
      ".mbc-bulle img,.mbc-bulle svg{",
      "  height:46px!important;max-height:46px!important;",
      "  width:46px!important;max-width:46px!important;",
      "  display:block;flex-shrink:0;object-fit:contain;",
      "  background:#fff;border-radius:100px;padding:3px;",
      "}",
      ".mbc-bulle-t{display:block;}",
      ".mbc-bulle-t small{",
      "  display:block;font-family:'Barlow',system-ui,sans-serif;",
      "  font-weight:600;font-size:11.5px;letter-spacing:.04em;",
      "  text-transform:none;opacity:.85;margin-top:3px;",
      "}",
      ".mbc-bulle-x{",
      "  position:absolute;top:-6px;right:-6px;",
      "  width:24px;height:24px;border:0;border-radius:100px;",
      "  background:#17181A;color:#fff;cursor:pointer;",
      "  font:700 15px/1 system-ui,sans-serif;",
      "  display:flex;align-items:center;justify-content:center;",
      "  box-shadow:0 2px 8px rgba(0,0,0,.3);padding:0;",
      "}",
      ".mbc-bulle-x:hover{background:#000;}",
      ".mbc-bulle-x:focus-visible{outline:3px solid #BA2A2F;outline-offset:2px;}",
      /* Sur petit écran, on garde la mascotte et on réduit le texte
         plutôt que de tout faire disparaître. */
      "@media (max-width:420px){",
      "  .mbc-bulle{right:12px;padding:7px 15px 7px 7px;font-size:15px;}",
      "  .mbc-bulle-t small{display:none;}",
      "}",
      "@media (prefers-reduced-motion:reduce){",
      "  .mbc-bulle{transition:none;opacity:1;transform:none;}",
      "}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* Si l'image de la mascotte manque un jour, on dessine un ballon
     plutôt que d'afficher une icône cassée. */
  function ballon() {
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="21" fill="#E87A2E"/>' +
      '<g fill="none" stroke="#17181A" stroke-width="2.2">' +
      '<circle cx="24" cy="24" r="21"/><path d="M3 24h42M24 3v42"/>' +
      '<path d="M9 9c9 6 9 24 0 30M39 9c-9 6-9 24 0 30"/></g></svg>';
  }

  function construire() {
    /* Dernier contrôle juste avant d'insérer : entre lancer() et ici
       il s'est écoulé DELAI millisecondes, pendant lesquelles un
       second exemplaire du script a pu passer. */
    if (document.querySelector(".mbc-bulle")) return;
    styles();

    var a = document.createElement("a");
    a.className = "mbc-bulle";
    a.href = JEU;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", "Jouer à MBC Shootout, le jeu du club, dans un nouvel onglet");
    a.innerHTML =
      '<img src="' + MASCOTTE + '" alt="">' +
      '<span class="mbc-bulle-t">Shootout<small>Le jeu du club</small></span>';

    var img = a.querySelector("img");
    img.addEventListener("error", function () {
      img.outerHTML = ballon();
    });

    var x = document.createElement("button");
    x.className = "mbc-bulle-x";
    x.type = "button";
    x.setAttribute("aria-label", "Masquer le raccourci vers le jeu");
    x.textContent = "×";
    x.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      memoriser();
      a.remove();
    });
    a.appendChild(x);

    document.body.appendChild(a);
    /* Deux images successives pour que la transition se joue. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { a.classList.add("mbc-bulle--visible"); });
    });
  }

  function lancer() {
    if (pageExclue()) return;
    if (dejaFermee()) return;
    /* Le header peut se retrouver collé deux fois sur une page. Chaque
       exemplaire du script a sa propre portée, donc le drapeau doit
       vivre sur window pour être vu par les deux, et être posé tout de
       suite : un simple test du DOM ne suffirait pas, la construction
       étant différée. */
    if (window.__mbcBulleJeu) return;
    window.__mbcBulleJeu = true;
    window.setTimeout(construire, DELAI);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", lancer);
  } else {
    lancer();
  }
})();
