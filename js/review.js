// Reviewmodus: alleen geladen met ?review=1 (zie index.html). Voor een gewone bezoeker
// bestaat deze laag niet; hij is niet alleen verborgen.
//
// Opmerkingen hangen aan data-onderwerp-ankers: een indicatorsleutel, een sectie of een
// open vraag. Expliciete sleutels, geen kopteksten, zodat een opmerking blijft kloppen als
// een label verandert. Verdwijnt een sleutel, dan komt de opmerking in de export onder
// "Onderwerp bestaat niet meer" in plaats van stil te verdwijnen.
//
// Opslag in de localStorage van de reviewer zelf; er gaat niets naar een server. Dat is geen
// bewaarplaats: het geëxporteerde bestand is de bron van waarheid.

(() => {
  // Eén dossier per pagina. Het overzicht houdt de oorspronkelijke sleutel, zodat eerdere
  // opmerkingen niet wegvallen.
  const PAGINA = document.body.dataset.pagina || "";
  const SLEUTEL = "opgavenreview/" + FUNCTIONEREN.rayon.code + (PAGINA ? "/" + PAGINA : "");
  const MENINGEN = {
    onmisbaar: "Onmisbaar",
    nuttig: "Nuttig",
    "niet-interessant": "Niet interessant",
    "anders-vormgeven": "Anders vormgeven",
  };

  let dossier = { versie: 1, reviewer: "", opmerkingen: {}, geexporteerd: true };
  let opslagWerkt = true;

  const leeg = (o) => !o || (!o.mening && !(o.opmerking || "").trim() && !(o.opgave || "").trim());

  // localStorage kan gooien (privévenster, geblokkeerde sitegegevens). Dan werken we in het
  // geheugen door en zegt de balk dat er geëxporteerd moet worden.
  function laad() {
    try {
      const ruw = localStorage.getItem(SLEUTEL);
      if (ruw) dossier = Object.assign(dossier, JSON.parse(ruw));
    } catch {
      opslagWerkt = false;
    }
  }
  function schrijf() {
    try {
      localStorage.setItem(SLEUTEL, JSON.stringify(dossier));
    } catch {
      opslagWerkt = false;
    }
    balk();
  }
  function wijzig(sleutel, veld, waarde) {
    const o = (dossier.opmerkingen[sleutel] ||= {});
    o[veld] = waarde;
    if (leeg(o)) delete dossier.opmerkingen[sleutel];
    dossier.geexporteerd = false;
    schrijf();
    markeer();
  }

  /* ---------- velden ---------- */
  function widget(el) {
    const s = el.dataset.onderwerp;
    const o = dossier.opmerkingen[s] || {};
    const d = document.createElement("div");
    d.className = "review";
    d.dataset.voor = s;
    d.innerHTML =
      el.dataset.review === "tekst"
        ? `<label>${el.dataset.reviewVraag || "Opmerking"}<textarea data-veld="opmerking" rows="2"></textarea></label>`
        : `<div class="rv-meningen" role="group" aria-label="Hoe nuttig is dit?">${Object.entries(MENINGEN)
            .map(([k, t]) => `<button type="button" data-mening="${k}" aria-pressed="${o.mening === k}">${t}</button>`)
            .join("")}</div>
           <label>Wat moet beter of anders?<textarea data-veld="opmerking" rows="2"></textarea></label>
           <label>Raakt welke opgave?<input data-veld="opgave"></label>`;
    d.querySelectorAll("[data-veld]").forEach((v) => (v.value = o[v.dataset.veld] || ""));
    return d;
  }

  // Idempotent: app.js herschrijft de tabellen bij elke render, de rest blijft staan.
  function versier() {
    document.querySelectorAll("[data-onderwerp]").forEach((el) => {
      const doel = el.matches("tr.ind") ? document.getElementById("k-" + el.dataset.id)?.firstElementChild : el;
      if (doel && !doel.querySelector(":scope > .review")) doel.appendChild(widget(el));
    });
    markeer();
  }
  function markeer() {
    document.querySelectorAll("tr.ind[data-onderwerp]").forEach((r) =>
      r.classList.toggle("rv-heeft", !leeg(dossier.opmerkingen[r.dataset.onderwerp]))
    );
  }

  document.addEventListener("input", (e) => {
    const v = e.target.closest(".review [data-veld]");
    if (v) wijzig(v.closest(".review").dataset.voor, v.dataset.veld, v.value);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".review [data-mening]");
    if (!b) return;
    const aan = b.getAttribute("aria-pressed") !== "true";
    b.parentElement.querySelectorAll("[data-mening]").forEach((x) => x.setAttribute("aria-pressed", x === b && aan));
    wijzig(b.closest(".review").dataset.voor, "mening", aan ? b.dataset.mening : "");
  });

  /* ---------- export ---------- */
  function blok(label, s) {
    const o = dossier.opmerkingen[s];
    const delen = [`### ${label} \`${s}\``];
    if (o.mening) delen.push(`**${MENINGEN[o.mening]}**`);
    if ((o.opmerking || "").trim()) delen.push(o.opmerking.trim());
    if ((o.opgave || "").trim()) delen.push(`Raakt opgave: ${o.opgave.trim()}`);
    return delen.join("\n\n") + "\n";
  }

  // Volgorde van de pagina, gegroepeerd per sectie.
  function markdown() {
    const uit = [
      `# Review · ${document.title}\n`,
      `Reviewer: ${dossier.reviewer || "onbekend"} · ${new Date().toLocaleDateString("nl-NL")}`,
      "_De waarden in de viewer zijn fictief; het gaat om de indicatoren en de vorm._\n",
    ];
    const gezien = new Set();
    document.querySelectorAll("main section[data-onderwerp]").forEach((sec) => {
      const ankers = [sec, ...sec.querySelectorAll("[data-onderwerp]")].filter((a) => !leeg(dossier.opmerkingen[a.dataset.onderwerp]));
      if (!ankers.length) return;
      uit.push(`## ${sec.dataset.label}\n`);
      ankers.forEach((a) => {
        gezien.add(a.dataset.onderwerp);
        uit.push(blok(a === sec && sec.dataset.reviewVraag ? sec.dataset.reviewVraag : a.dataset.label, a.dataset.onderwerp));
      });
    });
    const wees = Object.keys(dossier.opmerkingen).filter((s) => !gezien.has(s));
    if (wees.length) {
      uit.push("## Onderwerp bestaat niet meer\n");
      wees.forEach((s) => uit.push(blok(s, s)));
    }
    return uit.join("\n");
  }

  function bestandsnaam(ext) {
    const d = new Date();
    const jjmmdd = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("");
    const wie = (dossier.reviewer || "reviewer").trim().replace(/[^\p{L}\p{N}]+/gu, "-");
    return `${jjmmdd}_${wie}_review_functioneren${PAGINA ? "_" + PAGINA : ""}.${ext}`;
  }
  function download(naam, inhoud, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([inhoud], { type }));
    a.download = naam;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function kopieer() {
    const md = markdown();
    try {
      await navigator.clipboard.writeText(md);
      melding("Markdown gekopieerd.");
    } catch {
      download(bestandsnaam("md"), md, "text/markdown");
      melding("Kopiëren lukte niet; de Markdown is gedownload.");
    }
  }
  function exporteer() {
    download(bestandsnaam("json"), JSON.stringify(dossier, null, 2), "application/json");
    dossier.geexporteerd = true;
    schrijf();
  }

  /* ---------- balk ---------- */
  let telling, status;
  function melding(t) {
    status.textContent = t;
  }
  function balk() {
    if (!status) return;
    const n = Object.keys(dossier.opmerkingen).length;
    telling.textContent = `${n} ${n === 1 ? "opmerking" : "opmerkingen"}`;
    status.classList.toggle("rv-fout", !opslagWerkt);
    status.textContent = !opslagWerkt
      ? "Opslaan in deze browser lukt niet. Exporteer voordat je sluit."
      : dossier.geexporteerd
        ? "Opgeslagen in deze browser."
        : "Opgeslagen in deze browser, nog niet geëxporteerd.";
  }
  function maakBalk() {
    const b = document.createElement("div");
    b.className = "rv-balk";
    b.setAttribute("role", "region");
    b.setAttribute("aria-label", "Reviewmodus");
    b.innerHTML = `<b>Reviewmodus</b>
      <input class="rv-naam" placeholder="Je naam" aria-label="Je naam">
      <span class="rv-telling"></span>
      <button type="button" data-actie="kopieer">Kopieer als Markdown</button>
      <button type="button" data-actie="exporteer">Download JSON</button>
      <a href="${location.pathname.split("/").pop() || "index.html"}">Sluiten</a>
      <span class="rv-hint">${document.body.dataset.reviewHint || "Klik een indicator open om te reageren."}</span>
      <span class="rv-status" aria-live="polite"></span>`;
    document.body.appendChild(b);
    telling = b.querySelector(".rv-telling");
    status = b.querySelector(".rv-status");
    const naam = b.querySelector(".rv-naam");
    naam.value = dossier.reviewer;
    naam.oninput = () => {
      dossier.reviewer = naam.value;
      schrijf();
    };
    b.querySelector('[data-actie="kopieer"]').onclick = kopieer;
    b.querySelector('[data-actie="exporteer"]').onclick = exporteer;
  }

  function stijl() {
    const s = document.createElement("style");
    s.textContent = `
      body.rv{padding-bottom:110px}
      .review{display:grid;gap:8px;margin-top:12px;padding:10px 14px;background:var(--wit);border-top:2px dashed var(--schie);font-size:13px}
      tr.kaart .review{margin:0}
      .review label{display:grid;gap:3px;font-weight:700;color:var(--schie)}
      .review textarea,.review input{font:inherit;font-weight:400;color:var(--asfalt);background:var(--beton);border:1px solid var(--grid);border-radius:3px;padding:5px 8px;width:100%;resize:vertical}
      .rv-meningen{display:flex;flex-wrap:wrap;gap:6px}
      .rv-meningen button{background:var(--beton);border:1px solid var(--grid);border-radius:3px;padding:3px 9px;cursor:pointer;font-size:12.5px}
      .rv-meningen button[aria-pressed="true"]{background:var(--schie);border-color:var(--schie);color:#fff}
      tr.ind.rv-heeft td:first-child::after{content:" ●";color:var(--schie)}
      .rv-balk{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;
        padding:10px 16px;background:#000;color:#fff;font-size:13px;border-top:4px solid var(--schie)}
      .rv-balk input{background:#2b2b2b;border:1px solid #666;border-radius:3px;padding:3px 8px;color:#fff;width:150px}
      .rv-balk button{background:#fff;color:#000;border:0;border-radius:3px;padding:4px 10px;font-weight:700;cursor:pointer}
      .rv-balk a{color:#fff}
      .rv-hint,.rv-status{opacity:.8}
      .rv-status.rv-fout{color:#F2A08C;opacity:1;font-weight:700}
      @media(max-width:600px){body.rv{padding-bottom:170px} .rv-hint{display:none}}`;
    document.head.appendChild(s);
  }

  // Een fout hier mag de viewer niet meenemen.
  try {
    laad();
    stijl();
    document.body.classList.add("rv");
    maakBalk();
    versier();
    balk();
    document.addEventListener("gerenderd", versier);
  } catch (e) {
    console.error("[review]", e);
    document.body.dataset.reviewFouten = e.message;
  }
})();
