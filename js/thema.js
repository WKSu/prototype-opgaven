// Themaviewer: per indicator wat de gepubliceerde datalade nu kan beantwoorden.
// Redactie (definitie, status, wat er nodig is) komt uit FUNCTIONEREN in data/indicatoren.js;
// de cijfers uit DATALADE in data/datalade.js (gegenereerd). Echte cijfers, geen normen:
// dit is onderzoek, en rood hoort in het overzicht, niet hier.

// typeof, want een ontbrekend databestand mag geen ReferenceError geven: dan blijft de pagina
// stil leeg. Onderaan staat welk bestand ontbreekt.
const F = typeof FUNCTIONEREN !== "undefined" ? FUNCTIONEREN : null;
const D = typeof DATALADE !== "undefined" ? DATALADE : null;
const THEMA = F && F.themas.find((t) => t.sleutel === document.body.dataset.thema);
const GEBIED = F ? Object.fromEntries(F.gebieden.map((g) => [g.code, g.naam])) : {};
const STATUS = { ja: "Beantwoord", deels: "Deels", nee: "Niet in de datalade" };

function veilig(naam, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(`[${naam}]`, e);
    const b = document.body;
    b.dataset.veiligFouten = [b.dataset.veiligFouten, naam].filter(Boolean).join(" ");
    return `<div class="nodig"><b>Dit blok kon niet worden getekend</b>${naam}: ${e.message}</div>`;
  }
}

const fmt = (v, d = 0) =>
  v == null ? "–" : v.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const statusChip = (st) => `<span class="oordeel o-${st}">${STATUS[st]}</span>`;
const strip = (cellen) =>
  `<div class="strip">${cellen
    .map(([n, l, src]) => `<div class="cell"><div class="num">${n}</div><div class="lbl">${l}</div>${src ? `<div class="src">${src}</div>` : ""}</div>`)
    .join("")}</div>`;
const kort = (sha) => sha.slice(0, 7);
const bronDatalade = () => `datalade ${D.bronnen.datalade.repo} @ ${kort(D.bronnen.datalade.commit)}`;
const bronLoop = () => `verkenner ${D.bronnen.loopbaarheid.repo} @ ${kort(D.bronnen.loopbaarheid.commit)}`;

/* ---------- parkeren ---------- */

// Eenvoudige equirechthoekige projectie; lengtegraden geschaald met cos(breedte), anders rekt
// de kaart op deze breedte zo'n 60% uit.
function projectie(features, breedte) {
  const punten = features.flatMap((f) =>
    (f.geometrie.type === "Polygon" ? [f.geometrie.coordinates] : f.geometrie.coordinates).flat(2)
  );
  const lons = punten.map((p) => p[0]), lats = punten.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = breedte / ((x1 - x0) * k);
  return { xy: ([lon, lat]) => [(lon - x0) * k * s, (y1 - lat) * s], hoogte: (y1 - y0) * s };
}

function subbuurtKaart() {
  const sb = D.parkeren.subbuurten;
  const W = 800;
  const { xy, hoogte } = projectie(sb.kaart, W);
  const pad = (g) =>
    (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
      .flatMap((poly) => poly.map((ring) => "M" + ring.map((p) => xy(p).map((n) => n.toFixed(1)).join(",")).join("L") + "Z"))
      .join("");
  // Eén tint van licht naar donker: dit is een grootte, geen categorie.
  const grenzen = [0.6, 0.8, 1.0, 1.2];
  const tint = [18, 38, 58, 78, 100];
  const klasse = (v) => grenzen.filter((g) => v >= g).length;
  const kleur = (v) => (v == null ? "var(--beton-diep)" : `color-mix(in srgb, var(--schie) ${tint[klasse(v)]}%, var(--wit))`);
  const paden = sb.kaart
    .map((f) => `<path d="${pad(f.geometrie)}" fill="${kleur(f.autosPerWoonadres)}"><title>${f.naam} (${GEBIED[f.gebied]}): ${f.autosPerWoonadres == null ? "onbekend" : fmt(f.autosPerWoonadres, 2) + " auto’s per woonadres"}, ${fmt(f.woonadressen)} woonadressen</title></path>`)
    .join("");
  const labels = F.gebieden
    .map((g) => {
      const pts = sb.kaart.filter((f) => f.gebied === g.code).flatMap((f) => (f.geometrie.type === "Polygon" ? [f.geometrie.coordinates] : f.geometrie.coordinates).flat(2)).map(xy);
      const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle">${g.naam}</text>`;
    })
    .join("");
  const legenda = ["< 0,6", "0,6–0,8", "0,8–1,0", "1,0–1,2", "≥ 1,2"]
    .map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${tint[i]}%, var(--wit))"></i>${t}</span>`)
    .join("") + `<span><i style="background:var(--beton-diep)"></i>onbekend</span>`;
  const n = sb.aantalPerGebied;
  return `<h4 style="margin-top:18px">De ${sb.kaart.length} subbuurten van het rayon, gekleurd naar autobezit</h4>
    <p style="font-size:13.5px">Dit is de eenheid van de nieuwe indicator: ${F.gebieden.map((g) => `${n[g.code]} in ${g.naam}`).join(", ")}. Zonder metingen kan de kaart nog geen parkeerdruk tonen; de kleur is de vraagkant, geen druk.</p>
    <div class="legenda-rij"><b>Auto’s per woonadres</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurten met het autobezit per woonadres">${paden}${labels}</svg>
    <div class="foot">${sb.bron}. Peiljaar ${sb.peiljaar}, niveau ${sb.niveau}. ${sb.caveat} Bron: ${bronDatalade()}.</div>`;
}

function sectorTabel() {
  const ps = D.parkeren.sectoren;
  const metCijfers = ps.rijen.filter((r) => r.bezetting != null);
  const boven = metCijfers.filter((r) => r.bezetting > 90);
  const scanMax = Math.max(...metCijfers.map((r) => r.bezettingScan ?? 0));
  const gebieden = (r) => r.gebieden.map((c) => GEBIED[c]).join(", ") || "–";
  return `<h4 style="margin-top:22px">Wat er wel is: ${ps.rijen.length} parkeersectoren</h4>
    <p style="font-size:13.5px">${boven.length} van de ${metCijfers.length} sectoren met cijfers zitten met vergunningen ÷ capaciteit boven 90%. De scanmeting komt nergens boven ${fmt(scanMax)}%. Beide zijn geen parkeerdruk per subbuurt.</p>
    <div class="scroll"><table class="data" style="min-width:640px"><thead><tr>
      <th>Sector</th><th>Gebied</th><th class="getal">Deel in rayon</th><th class="getal">Capaciteit</th>
      <th class="getal">Vergunningen</th><th class="getal">Vergunningen ÷ capaciteit</th><th class="getal">Scanbezetting</th></tr></thead><tbody>
      ${ps.rijen
        .map((r) => `<tr><td>${r.id}</td><td>${gebieden(r)}</td><td class="getal">${fmt(r.deelInRayon)}%</td><td class="getal">${fmt(r.capaciteit)}</td>
          <td class="getal">${r.capaciteit == null ? "–" : fmt((r.vergunningenBewoners ?? 0) + (r.vergunningenBedrijven ?? 0))}</td>
          <td class="getal">${r.bezetting == null ? "–" : fmt(r.bezetting, 1) + "%"}</td><td class="getal">${r.bezettingScan == null ? "–" : fmt(r.bezettingScan, 1) + "%"}</td></tr>`)
        .join("")}</tbody></table></div>
    <div class="foot">${ps.bron}, gebouwd ${ps.gebouwd}. Vergunningen ÷ capaciteit = ${ps.bezettingRegel}. ${ps.scanCaveat} ${ps.caveat} Sectoren zonder cijfers: ${ps.zonderCijfers.join(", ")}. Bron: ${bronDatalade()}.</div>`;
}

function wachtlijstTabel() {
  const ps = D.parkeren.sectoren;
  const rijen = ps.rijen.filter((r) => r.plafond != null);
  return `<div class="scroll"><table class="data" style="min-width:520px"><thead><tr>
      <th>Sector</th><th>Gebied</th><th class="getal">Plafond</th><th class="getal">Vergunningen bewoners</th>
      <th class="getal">Wachtlijst bewoners</th><th class="getal">Wachtlijst bedrijven</th></tr></thead><tbody>
      ${rijen
        .map((r) => `<tr><td>${r.id}</td><td>${r.gebieden.map((c) => GEBIED[c]).join(", ")}</td><td class="getal">${fmt(r.plafond)}</td>
          <td class="getal">${fmt(r.vergunningenBewoners)}</td><td class="getal">${fmt(r.wachtlijstBewoners)}</td><td class="getal">${fmt(r.wachtlijstBedrijven)}</td></tr>`)
        .join("")}</tbody></table></div>
    <div class="foot">Aantal wachtenden op de peildatum, geen wachttijd. ${ps.bron}, gebouwd ${ps.gebouwd}. Bron: ${bronDatalade()}.</div>`;
}

/* ---------- OV ---------- */

const ov = (code) => D.ov.perGebied[code];

function frequentie() {
  const dr = D.ov.drempels.avondPerRichting;
  const klassen = [
    ["geen vertrek in de avond", (v) => v === 0],
    ["minder dan 2 per uur", (v) => v > 0 && v < 2],
    [`2 tot ${dr} per uur`, (v) => v >= 2 && v < dr],
    [`${dr} of meer per uur`, (v) => v >= dr],
  ];
  const kop = F.gebieden.map((g) => `<th class="getal">${g.naam}</th>`).join("");
  const verdeling = klassen
    .map(([naam, test]) => `<tr><td>${naam}</td>${F.gebieden.map((g) => `<td class="getal">${ov(g.code).frequentie.haltesLijst.filter((h) => test(h.avondMax)).length}</td>`).join("")}</tr>`)
    .join("");
  const lijsten = F.gebieden
    .map((g) => {
      const hs = [...ov(g.code).frequentie.haltesLijst].sort((a, b) => b.avondMax - a.avondMax);
      return `<details><summary>Haltes in ${g.naam} (${hs.length})</summary><div class="scroll"><table class="data" style="min-width:480px">
        <thead><tr><th>Halte</th><th>Vervoerwijze</th><th>Beste lijn in de avond</th><th class="getal">Per uur per richting</th></tr></thead><tbody>
        ${hs.map((h) => `<tr><td>${h.naam}</td><td>${h.modi.join(", ")}</td><td>${h.lijnen[0] ? `${h.lijnen[0].lijn} (${h.lijnen[0].modus})` : "–"}</td><td class="getal">${fmt(h.avondMax, 1)}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    })
    .join("");
  return `${strip(F.gebieden.map((g) => {
      const f = ov(g.code).frequentie;
      return [`${f.voldoen} van ${f.haltes}`, `haltes in ${g.naam} met ${dr} of meer per uur per richting in de avond`, "datalade"];
    }))}
    <h4 style="margin-top:18px">Hoe gevoelig is dat voor de grens van ${dr}?</h4>
    <p style="font-size:13.5px">Haltes naar de beste lijn in de avond (gemiddeld over 18–24 uur, per richting). Ligt een groot deel net onder de grens, dan bepaalt de keuze van de grens het beeld.</p>
    <div class="scroll"><table class="data" style="min-width:480px"><thead><tr><th>Beste lijn in de avond</th>${kop}</tr></thead><tbody>${verdeling}</tbody></table></div>
    ${lijsten}
    <h4 style="margin-top:22px">Vertrekken per uur op een werkdag</h4>
    <p style="font-size:13.5px">Alle vertrekken vanaf haltes binnen het gebied, alle richtingen en vervoerwijzen samen. De avond (vanaf 18 uur) is donker. Zelfde schaal voor de drie gebieden.</p>
    ${uurprofiel()}
    <div class="foot">Frequentie per halte: ${D.ov.loopbaarheidBron}; bron: ${bronLoop()}. Een halte hoort bij een gebied als hij binnen de buurtgrenzen ligt. Uurprofiel: ${ov(F.gebieden[0].code).gtfsBron}, peildatum ${ov(F.gebieden[0].code).gtfsPeildatum}; bron: ${bronDatalade()}. De twee bronnen tellen haltes verschillend (per haltecluster en vervoerwijze tegenover per GTFS-halte).</div>`;
}

function uurprofiel() {
  const max = Math.max(...F.gebieden.flatMap((g) => ov(g.code).uurprofiel));
  const W = 720, H = 96, onder = 16, bw = W / 24;
  return `<div class="uren">${F.gebieden
    .map((g) => {
      const u = ov(g.code).uurprofiel;
      const staven = u
        .map((v, i) => {
          const h = ((H - onder - 6) * v) / max;
          const kleur = i >= 18 ? "var(--schie)" : "color-mix(in srgb, var(--schie) 35%, var(--wit))";
          return `<g><rect x="${(i * bw + 1).toFixed(1)}" y="${(H - onder - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${kleur}"/>
            <rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent"><title>${g.naam}, ${i}:00–${i + 1}:00 uur: ${fmt(v)} vertrekken</title></rect></g>`;
        })
        .join("");
      const ticks = [0, 6, 12, 18, 23].map((i) => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="11" fill="var(--stil)">${i}u</text>`).join("");
      return `<div class="rij"><b>${g.naam}</b> <span class="toel">piek ${fmt(Math.max(...u))}, om 21 uur ${fmt(u[21])} vertrekken</span>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vertrekken per uur in ${g.naam}"><line x1="0" x2="${W}" y1="${H - onder}" y2="${H - onder}" stroke="var(--grid)"/>${staven}${ticks}</svg></div>`;
    })
    .join("")}</div>`;
}

function haltedekking() {
  const dr = D.ov.drempels;
  const rijen = F.gebieden.flatMap((g) => ov(g.code).dekking.perBuurt.map((b) => ({ ...b, gebied: g.naam }))).sort((a, b) => (a.aandeel ?? 999) - (b.aandeel ?? 999));
  return `${strip(F.gebieden.map((g) => {
      const d = ov(g.code).dekking;
      return [`${fmt(d.aandeel, 1)}%`, `van de ${fmt(d.woonadressen)} woonadressen in ${g.naam}`, "datalade"];
    }))}
    <h4 style="margin-top:18px">Per buurt, laagste dekking eerst</h4>
    <div class="scroll"><table class="data" style="min-width:520px"><thead><tr><th>Buurt</th><th>Gebied</th><th class="getal">Woonadressen</th><th class="getal">Inwoners</th><th>Binnen loopafstand</th></tr></thead><tbody>
      ${rijen.map((b) => `<tr><td>${b.naam}</td><td>${b.gebied}</td><td class="getal">${fmt(b.woonadressen)}</td><td class="getal">${fmt(b.inwoners)}</td>
        <td>${b.aandeel == null ? "–" : `<span class="staaf" style="width:${b.aandeel * 1.2}px"></span>${fmt(b.aandeel, 1)}%`}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="foot">Binnen ${dr.busTramM} m lopen van een bus- of tramhalte of ${dr.metroTreinM} m van een metro- of treinstation, over het looproutenetwerk (OSM). Woonadressen = adressen in panden met een woonfunctie; een gemengd pand telt met al zijn adressen mee. Buurten met weinig adressen geven grote sprongen. ${D.ov.loopbaarheidBron}; bron: ${bronLoop()}.</div>`;
}

function lijnenPerGebied() {
  return F.gebieden
    .map((g) => {
      const ls = ov(g.code).lijnen;
      const perSoort = Object.entries(ls.reduce((a, l) => ((a[l.soort] = (a[l.soort] || 0) + 1), a), {})).map(([s, n]) => `${n} ${s}`).join(", ");
      return `<details><summary>${g.naam}: ${ls.length} lijnen (${perSoort})</summary><div class="scroll"><table class="data" style="min-width:560px">
        <thead><tr><th>Lijn</th><th>Soort</th><th>Traject</th><th class="getal">Ritten per dag</th><th class="getal">Laatste rit</th></tr></thead><tbody>
        ${ls.map((l) => `<tr><td>${l.lijn}</td><td>${l.soort}</td><td>${l.traject}</td><td class="getal">${fmt(l.ritten)}</td><td class="getal">${(l.laatste || "–").slice(0, 5)}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    })
    .join("") + `<div class="foot">Lijnen die minstens één halte in of nabij het gebied aandoen, beide richtingen samen. ${ov(F.gebieden[0].code).gtfsBron}, peildatum ${ov(F.gebieden[0].code).gtfsPeildatum}. Bron: ${bronDatalade()}.</div>`;
}

const VISUEEL = {
  "parkeerdruk-subbuurt": () => subbuurtKaart() + sectorTabel(),
  "wachttijd-vergunning": wachtlijstTabel,
  "ov-frequentie": frequentie,
  "ov-haltedekking": haltedekking,
  "ov-meerzijdig": lijnenPerGebied,
};

/* ---------- pagina ---------- */

function blok(ind) {
  const dl = ind.datalade;
  const vis = VISUEEL[ind.sleutel];
  return `<section id="i-${ind.sleutel}" data-onderwerp="onderzoek-${ind.sleutel}" data-label="${ind.naam}">
    ${ind.groep ? `<div class="eyebrow">${ind.groep}</div>` : ""}
    <h2>${ind.naam} ${statusChip(dl.status)}</h2>
    <p class="def">${ind.definitie}</p>
    <div class="box"><h4>Wat de datalade nu zegt</h4><p style="font-size:14.5px">${dl.tekst}</p>
      ${dl.kerncijfers ? strip(dl.kerncijfers) : ""}
      ${vis ? veilig(ind.sleutel, vis) : ""}</div>
    ${dl.nodig ? `<div class="nodig"><b>Nodig om dit te beantwoorden</b>${dl.nodig}</div>` : ""}
    ${ind.letop ? `<p class="foot">Let op: ${ind.letop}</p>` : ""}
  </section>`;
}

function pagina() {
  const inds = THEMA.indicatoren;
  const tel = (st) => inds.filter((i) => i.datalade.status === st).length;
  const open = inds.filter((i) => i.datalade.nodig);
  document.getElementById("inhoud").innerHTML = `
    <section id="s0" data-onderwerp="${THEMA.sleutel}-overzicht" data-label="Overzicht" data-review="tekst" data-review-vraag="Wat mis je in deze viewer?" style="border-bottom:4px solid var(--asfalt)">
      <div class="eyebrow">Onderzoek · Rayon ${F.rayon.naam}</div>
      <h1>${THEMA.naam}</h1>
      <p class="lead">Wat kan de gepubliceerde datalade al beantwoorden? Per indicator: wat er staat, wat ontbreekt en welke data nodig is. Echte cijfers, zonder normen of oordeel.</p>
      ${strip([
        [tel("ja"), "beantwoord", "van " + inds.length],
        [tel("deels"), "deels te beantwoorden", "van " + inds.length],
        [tel("nee"), "niet in de datalade", "van " + inds.length],
      ])}
    </section>
    ${inds.map(blok).join("")}
    <section id="nodig" data-onderwerp="${THEMA.sleutel}-nodig" data-label="Wat er nodig is" data-review="tekst" data-review-vraag="Welke data kun je leveren, en wanneer?" style="border-bottom:0">
      <div class="eyebrow">Wat er nodig is</div>
      <h2>${open.length} vragen om data of een besluit</h2>
      <div class="scroll"><table class="data" style="min-width:560px"><thead><tr><th>Indicator</th><th>Status</th><th>Nodig</th></tr></thead><tbody>
        ${open.map((i) => `<tr><td><a href="#i-${i.sleutel}">${i.naam}</a></td><td>${statusChip(i.datalade.status)}</td><td>${i.datalade.nodig}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="foot">Bronnen: <a href="${D.bronnen.datalade.url}#gebied=${F.rayon.code}">${bronDatalade()}</a> · <a href="${D.bronnen.loopbaarheid.url}">${bronLoop()}</a>. Regenereren met <code>scripts/bouw_datalade.py</code>.</p>
    </section>`;
  document.dispatchEvent(new Event("gerenderd"));
}

const ontbreekt = [!F && "data/indicatoren.js", !D && "data/datalade.js"].filter(Boolean);
const inhoud = document.getElementById("inhoud");
if (ontbreekt.length) {
  document.body.dataset.veiligFouten = "data";
  inhoud.innerHTML = `<section><div class="nodig"><b>Deze viewer kon niet worden opgebouwd</b>
    Niet geladen: ${ontbreekt.join(", ")}. Dat gebeurt als je dit HTML-bestand los opent, bijvoorbeeld als
    voorbeeldweergave of bijlage. Open de hele map, of de GitHub Pages-versie.</div></section>`;
} else {
  // veilig() geeft bij een fout een melding terug; die moet op de pagina, anders blijft hij leeg.
  const fout = veilig("pagina", pagina);
  if (fout) inhoud.innerHTML = `<section>${fout}</section>`;
}
