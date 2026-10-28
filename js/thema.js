// Themaviewer: per indicator wat de gepubliceerde datalade nu kan beantwoorden.
// Redactie (definitie, status, wat er nodig is) komt uit FUNCTIONEREN in data/indicatoren.js;
// de cijfers uit DATALADE in data/datalade.js (gegenereerd). Echte cijfers, geen oordelen:
// dit is onderzoek. Enige uitzondering is de rode arcering op de parkeerdrukkaart, waar een
// norm uit FUNCTIONEREN.normen achter zit.

// typeof, want een ontbrekend databestand mag geen ReferenceError geven: dan blijft de pagina
// stil leeg. Onderaan staat welk bestand ontbreekt.
const F = typeof FUNCTIONEREN !== "undefined" ? FUNCTIONEREN : null;
const D = typeof DATALADE !== "undefined" ? DATALADE : null;
// Parkeertellingen: los bestand, want de bron is een handmatige levering en geen datalade.
const P = typeof PARKEERDRUK !== "undefined" ? PARKEERDRUK : null;
// Zelfde soort losse leveringen: enquêtecijfers en ruimtebeslag uit BGT en tellingen.
const RC = typeof RAPPORTCIJFER !== "undefined" ? RAPPORTCIJFER : null;
const RB = typeof RUIMTEBESLAG !== "undefined" ? RUIMTEBESLAG : null;
const FP = typeof FIETSPARKEREN !== "undefined" ? FIETSPARKEREN : null;
const THEMA = F && F.themas.find((t) => t.sleutel === document.body.dataset.thema);
// Extra gebieden (de Spaanse Polder) staan in de parkeertelling, niet in het rayon: wel op de
// kaart en in de tabellen, niet in de gebiedscijfers van het overzicht.
const EXTRA = P && P.extraGebieden ? P.extraGebieden : [];
const ALLE_GEBIEDEN = [...(F ? F.gebieden : []), ...EXTRA];
const RAYON = new Set(F ? F.gebieden.map((g) => g.code) : []);
const GEBIED = Object.fromEntries(ALLE_GEBIEDEN.map((g) => [g.code, g.naam]));
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

// Web Mercator in radialen: dezelfde projectie als de PDOK-tegels, zodat die er precies onder passen.
const merc = ([lon, lat]) => [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
const PDOK = "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857";

function projectie(features, breedte) {
  const punten = features
    .flatMap((f) => (f.geometrie.type === "Polygon" ? [f.geometrie.coordinates] : f.geometrie.coordinates).flat(2))
    .map(merc);
  const xs = punten.map((p) => p[0]), ys = punten.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = breedte / (x1 - x0);
  const hoogte = (y1 - y0) * s;
  return {
    xy: (p) => {
      const [x, y] = merc(p);
      return [(x - x0) * s, (y1 - y) * s];
    },
    hoogte,
    ondergrond: ondergrond(x0, y1, s, breedte, hoogte),
  };
}

// BRT-Achtergrondkaart grijs van PDOK: kleurt niet mee met de vlakken erboven. Zonder netwerk
// laden de tegels niet en blijft de kaart leesbaar zonder ondergrond.
function ondergrond(x0, y1, s, breedte, hoogte) {
  // Zoom waarop een tegel zo'n 180 eenheden breed is: scherp op een scherm van 1040 px.
  const z = Math.min(19, Math.ceil(Math.log2((2 * Math.PI * s) / 180)));
  const t = (2 * Math.PI) / 2 ** z, d = t * s;
  const kol = (x) => Math.floor((x + Math.PI) / t), rij = (y) => Math.floor((Math.PI - y) / t);
  const tegels = [];
  for (let tx = kol(x0); tx <= kol(x0 + breedte / s); tx++)
    for (let ty = rij(y1); ty <= rij(y1 - hoogte / s); ty++) {
      const x = (tx * t - Math.PI - x0) * s, y = (y1 - (Math.PI - ty * t)) * s;
      // Halve eenheid overlap tegen naden tussen de tegels.
      tegels.push(`<image href="${PDOK}/${z}/${tx}/${ty}.png" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(d + 0.5).toFixed(1)}" height="${(d + 0.5).toFixed(1)}"/>`);
    }
  // Geneste svg knipt de tegels af op het kader; anders lopen ze door in de marge die de
  // browser naast de kaart laat als max-height de hoogte begrenst.
  return `<svg width="${breedte}" height="${hoogte.toFixed(1)}" style="pointer-events:none">${tegels.join("")}</svg>`;
}
// Witte waas buiten het rayon (evenodd: kader min de vlakken), zodat de ondergrond daar
// context blijft en het rayon zelf naar voren komt.
const sluier = (features, pad, breedte, hoogte) =>
  `<path d="M0,0H${breedte}V${hoogte.toFixed(1)}H0Z${features.map((f) => pad(f.geometrie)).join("")}" fill="var(--wit)" fill-rule="evenodd" style="fill-opacity:.55;stroke:none;pointer-events:none"/>`;
const bronvermelding = (breedte, hoogte) =>
  `<text x="${breedte - 4}" y="${(hoogte - 4).toFixed(0)}" text-anchor="end" style="font-size:9.5px;font-weight:400">Achtergrond: PDOK / © Kadaster, CC-BY 4.0</text>`;

const polygonen = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const padVan = (xy) => (g) =>
  polygonen(g)
    .flatMap((poly) => poly.map((ring) => "M" + ring.map((p) => xy(p).map((n) => n.toFixed(1)).join(",")).join("L") + "Z"))
    .join("");
// Gebiedsnaam op het gemiddelde van alle hoekpunten van zijn vlakken.
const gebiedLabels = (features, xy) =>
  ALLE_GEBIEDEN.map((g) => {
      const pts = features.filter((f) => f.gebied === g.code).flatMap((f) => polygonen(f.geometrie).flat(2)).map(xy);
      if (!pts.length) return "";
      const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle">${g.naam}</text>`;
  }).join("");

function subbuurtKaart() {
  const sb = D.parkeren.subbuurten;
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(sb.kaart, W);
  const pad = padVan(xy);
  // Eén tint van licht naar donker: dit is een grootte, geen categorie.
  const grenzen = [0.6, 0.8, 1.0, 1.2];
  const tint = [18, 38, 58, 78, 100];
  const klasse = (v) => grenzen.filter((g) => v >= g).length;
  const kleur = (v) => (v == null ? "var(--beton-diep)" : `color-mix(in srgb, var(--schie) ${tint[klasse(v)]}%, var(--wit))`);
  const paden = sb.kaart
    .map((f) => `<path d="${pad(f.geometrie)}" fill="${kleur(f.autosPerWoonadres)}"><title>${f.naam} (${GEBIED[f.gebied]}): ${f.autosPerWoonadres == null ? "onbekend" : fmt(f.autosPerWoonadres, 2) + " auto’s per woonadres"}, ${fmt(f.woonadressen)} woonadressen</title></path>`)
    .join("");
  const labels = gebiedLabels(sb.kaart, xy);
  const legenda = ["< 0,6", "0,6–0,8", "0,8–1,0", "1,0–1,2", "≥ 1,2"]
    .map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${tint[i]}%, var(--wit))"></i>${t}</span>`)
    .join("") + `<span><i style="background:var(--beton-diep)"></i>onbekend</span>`;
  const n = sb.aantalPerGebied;
  return `<h4 style="margin-top:18px">De ${sb.kaart.length} subbuurten van het rayon, gekleurd naar autobezit</h4>
    <p style="font-size:13.5px">Dit is de eenheid van de indicator: ${F.gebieden.map((g) => `${n[g.code]} in ${g.naam}`).join(", ")}. De kleur is de vraagkant, geen druk. Lees hem naast de telling hierboven: veel auto’s per woonadres en een volle straat versterken elkaar.</p>
    <div class="legenda-rij"><b>Auto’s per woonadres</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurten met het autobezit per woonadres">${ondergrond}${sluier(sb.kaart, pad, W, hoogte)}${paden}${labels}${bronvermelding(W, hoogte)}</svg>
    <div class="foot">${sb.bron}. Peiljaar ${sb.peiljaar}, niveau ${sb.niveau}. ${sb.caveat} Bron: ${bronDatalade()}.</div>`;
}

function sectorTabel() {
  const ps = D.parkeren.sectoren;
  const metCijfers = ps.rijen.filter((r) => r.bezetting != null);
  const boven = metCijfers.filter((r) => r.bezetting > 90);
  const scanMax = Math.max(...metCijfers.map((r) => r.bezettingScan ?? 0));
  const gebieden = (r) => r.gebieden.map((c) => GEBIED[c]).join(", ") || "–";
  const geteld = Object.fromEntries((P ? P.sectoren : []).map((s) => [s.id, s]));
  const nacht = (id) => {
    const s = geteld[id];
    if (!s) return "–";
    return s.nachtdruk == null ? `<span class="toel">niet geteld</span>` : `${fmt(s.nachtdruk, 1)}%<div class="toel">${s.geteld} van ${s.subbuurtdelen} ${s.subbuurtdelen === 1 ? "deel" : "delen"}</div>`;
  };
  return `<h4 style="margin-top:22px">Wat er al lag: ${ps.rijen.length} parkeersectoren</h4>
    <p style="font-size:13.5px">${boven.length} van de ${metCijfers.length} sectoren met cijfers zitten met vergunningen ÷ capaciteit boven 90%. De scanmeting komt nergens boven ${fmt(scanMax)}%. Beide zijn geen parkeerdruk per subbuurt. De laatste kolom is wel een telling: de werkdagnacht over de getelde subbuurtdelen waarvan het middelpunt in de sector ligt.</p>
    <div class="scroll"><table class="data" style="min-width:720px"><thead><tr>
      <th>Sector</th><th>Gebied</th><th class="getal">Deel in rayon</th><th class="getal">Capaciteit</th>
      <th class="getal">Vergunningen</th><th class="getal">Vergunningen ÷ capaciteit</th><th class="getal">Scanbezetting</th><th class="getal">Telling, nacht</th></tr></thead><tbody>
      ${ps.rijen
        .map((r) => `<tr><td>${r.id}</td><td>${gebieden(r)}</td><td class="getal">${fmt(r.deelInRayon)}%</td><td class="getal">${fmt(r.capaciteit)}</td>
          <td class="getal">${r.capaciteit == null ? "–" : fmt((r.vergunningenBewoners ?? 0) + (r.vergunningenBedrijven ?? 0))}</td>
          <td class="getal">${r.bezetting == null ? "–" : fmt(r.bezetting, 1) + "%"}</td><td class="getal">${r.bezettingScan == null ? "–" : fmt(r.bezettingScan, 1) + "%"}</td><td class="getal">${nacht(r.id)}</td></tr>`)
        .join("")}</tbody></table></div>
    <div class="foot">${ps.bron}, gebouwd ${ps.gebouwd}. Vergunningen ÷ capaciteit = ${ps.bezettingRegel}. ${ps.scanCaveat} ${ps.caveat} Sectoren zonder cijfers: ${ps.zonderCijfers.join(", ")}. Bron: ${bronDatalade()}${P ? `; telling: ${P.bron}` : ""}.</div>`;
}

/* ---------- parkeertellingen ---------- */

const MOMENT = {
  werkdagnacht: "werkdagnacht",
  werkdagavond: "werkdagavond",
  werkdagdag: "werkdag overdag",
  weekendnacht: "weekendnacht",
  weekendavond: "weekendavond",
  weekenddag: "weekend overdag",
};
// Zelfde stappen voor telling en sector, zodat de twee kaarten naast elkaar te lezen zijn. De
// grenzen 85 en 90 komen uit de nota; ze zijn hier klassegrenzen, geen oordeel.
const DRUK_GRENZEN = [70, 85, 90, 100];
const DRUK_TINT = [18, 38, 58, 78, 100];
const DRUK_LABELS = ["tot 70%", "70–85%", "85–90%", "90–100%", "boven 100%"];
const drukKleur = (v) => `color-mix(in srgb, var(--schie) ${DRUK_TINT[DRUK_GRENZEN.filter((g) => v > g).length]}%, var(--wit))`;
const ARCERING = "repeating-linear-gradient(45deg, var(--schie) 0 1.5px, var(--beton-diep) 1.5px 5px)";
const arceerPatroon = (id) =>
  `<defs><pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--beton-diep)"/><rect width="1.5" height="5" fill="var(--schie)"/></pattern></defs>`;
// Andere hoek en kleur dan ARCERING: rode lijnen over de klassekleur, zonder eigen vulling.
const ROOD_ARCERING = "repeating-linear-gradient(-45deg, var(--rood) 0 1.5px, transparent 1.5px 5px)";
const roodPatroon = (id) =>
  `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="1.8" height="6" fill="var(--rood)"/></pattern></defs>`;
const drukLegenda = (extra) =>
  DRUK_LABELS.map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${DRUK_TINT[i]}%, var(--wit))"></i>${t}</span>`).join("") + extra;

const telling = (i) => P.tellingen[i];
const jaar = (t) => String(t.metingen[0].datum).slice(-4);
const tellingNaam = (t) => `${t.naam} (${t.bureau}, ${jaar(t)})`;

// Sectoren 99 en 100 omvatten alle andere in het rayon en hebben geen cijfers. Getekend als vlak
// bedekken ze de kaart; daarom alleen als stippellijn, zonder label.
const overkoepelend = (s) =>
  P.sectoren.some((t) => t !== s && t.delen.length < s.delen.length && t.delen.every((c) => s.delen.includes(c)));
// Sectoren lopen ver buiten het rayon door; knip ze af op de subbuurtdelen.
const rayonKnip = (id, pad) => `<clipPath id="${id}"><path d="${P.subbuurtdelen.map((d) => pad(d.geometrie)).join("")}"/></clipPath>`;
// Label op het gemiddelde van de subbuurtdelen in de sector: valt altijd binnen het rayon.
function sectorLabels(sectoren, xy) {
  const deel = Object.fromEntries(P.subbuurtdelen.map((d) => [d.code, d]));
  return sectoren
    .map((s) => {
      const pts = s.delen.flatMap((c) => polygonen(deel[c].geometrie).flat(2)).map(xy);
      const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" style="font-size:11.5px">${s.id}</text>`;
    })
    .join("");
}

// Alleen subbuurten met woonadressen (die van de autobezitkaart): daar gaat de norm over.
// De tellingen raken ook een paar subbuurten zonder woningen, zoals bedrijventerreinen. Een
// extra gebied buiten het rayon staat niet op de autobezitkaart: daar alle getelde subbuurten.
function drukPerGebied(code) {
  const woon = new Set(D.parkeren.subbuurten.kaart.map((k) => k.code));
  const sb = P.subbuurten.filter((s) => s.gebied === code && (!RAYON.has(code) || woon.has(s.code)));
  const geteld = sb.filter((s) => s.druk != null);
  return {
    totaal: sb.length,
    geteld,
    boven: geteld.filter((s) => s.druk > 90),
    tussen: geteld.filter((s) => s.druk > 85 && s.druk <= 90),
    deels: geteld.filter((s) => !s.volledig),
  };
}

function parkeerdrukKaart() {
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(P.subbuurtdelen, W);
  const pad = padVan(xy);
  const vulling = (d) =>
    d.druk != null ? drukKleur(d.druk) : d.hoogste ? "url(#pd-arcering)" : d.telling != null ? "var(--beton)" : "var(--beton-diep)";
  const titel = (d) => {
    const kop = `${d.buurt}, subbuurtdeel ${d.code}`;
    if (d.telling == null) return `${kop}: niet geteld`;
    const t = tellingNaam(telling(d.telling));
    if (d.druk != null) return `${kop}: ${fmt(d.druk, 1)}% op de ${MOMENT[d.moment]}, ${fmt(d.bezetting)} auto’s op ${fmt(d.capaciteit)} plekken. ${t}`;
    if (d.hoogste) return `${kop}: geen werkdagnacht of late werkdagavond geteld. Hoogste meting ${fmt(d.hoogste.druk, 1)}% (${MOMENT[d.hoogste.soort]}). ${t}`;
    return `${kop}: geteld, maar geen openbare parkeerplaatsen. ${t}`;
  };
  const paden = P.subbuurtdelen.map((d) => `<path d="${pad(d.geometrie)}" fill="${vulling(d)}"><title>${titel(d)}</title></path>`).join("");
  // Rood mag hier: boven 90% grijpt de norm uit de nota Betaald parkeren in (FUNCTIONEREN.normen).
  // Per subbuurt, want daar gaat de norm over; over de kleur heen, zodat de klasse leesbaar blijft.
  const boven = new Set(P.subbuurten.filter((s) => s.druk > 90).map((s) => s.code));
  const rood = P.subbuurtdelen
    .filter((d) => boven.has(d.subbuurt))
    .map((d) => `<path d="${pad(d.geometrie)}" fill="url(#pd-rood)" style="fill-opacity:1;stroke:var(--rood);stroke-width:1.2;pointer-events:none"/>`)
    .join("");
  // Sectorgrenzen erover: zo valt te zien welke telling bij welke vergunningsector hoort.
  const eigen = P.sectoren.filter((s) => !overkoepelend(s));
  const sectoren = `<g clip-path="url(#pd-rayon)">${eigen
    .map((s) => `<path d="${pad(s.geometrie)}" style="fill:none;stroke:var(--asfalt);stroke-width:1.4;stroke-dasharray:5 3;pointer-events:none"/>`)
    .join("")}</g>${sectorLabels(eigen, xy)}`;
  const legenda = drukLegenda(
    `<span><i style="background:${ROOD_ARCERING};border-color:var(--rood)"></i>subbuurt boven 90%: norm overschreden</span><span><i style="background:${ARCERING}"></i>geteld, geen werkdagnacht of -avond</span><span><i style="background:var(--beton)"></i>geteld, geen plekken</span><span><i style="background:var(--beton-diep)"></i>niet geteld</span><span><i style="border:1.5px dashed var(--asfalt);background:transparent"></i>parkeersector</span>`
  );
  return `<div class="legenda-rij"><b>Bruto parkeerdruk, werkdagnacht</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurtdelen met de gemeten parkeerdruk op de werkdagnacht">${arceerPatroon("pd-arcering")}${roodPatroon("pd-rood")}${rayonKnip("pd-rayon", pad)}${ondergrond}${sluier(P.subbuurtdelen, pad, W, hoogte)}${paden}${rood}${sectoren}${gebiedLabels(P.subbuurtdelen, xy)}${bronvermelding(W, hoogte)}</svg>`;
}

function tellingenTabel() {
  const max = Math.max(...P.tellingen.flatMap((t) => t.metingen.map((m) => m.druk ?? 0)));
  const rijen = P.tellingen
    .map((t) => {
      const ms = t.metingen
        .map((m) => {
          const nacht = m.soort === t.maatgevend;
          const w = m.druk == null ? 0 : (110 * m.druk) / max;
          return `<div style="display:grid;grid-template-columns:1fr 118px 4.2em;gap:8px;align-items:center;${nacht ? "font-weight:700" : ""}">
            <span>${m.id} · ${m.dag.toLowerCase()} ${m.tijd} · ${MOMENT[m.soort]}</span>
            <span><span class="staaf" style="width:${w.toFixed(0)}px;${nacht ? "" : "opacity:.45"}"></span></span><span style="text-align:right">${m.druk == null ? "–" : fmt(m.druk, 1) + "%"}</span></div>`;
        })
        .join("");
      return `<tr><td>${t.naam}<div class="toel">${t.bureau}, ${t.code}</div></td><td>${t.gebieden.map((c) => GEBIED[c]).join(", ")}</td><td class="getal">${fmt(t.subbuurtdelen)}</td><td>${ms}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="data" style="min-width:680px"><thead><tr><th>Telling</th><th>Gebied</th><th class="getal">Subbuurtdelen</th><th>Druk per meting, over de getelde subbuurtdelen in de analyse</th></tr></thead><tbody>${rijen}</tbody></table></div>`;
}

function subbuurtDrukTabel(rijen) {
  return `<div class="scroll"><table class="data" style="min-width:600px"><thead><tr><th>Subbuurt</th><th>Buurt</th><th>Gebied</th><th class="getal">Plekken</th><th>Druk</th><th class="getal">Geteld</th></tr></thead><tbody>
    ${rijen
      .map((s) => `<tr><td>${s.code}</td><td>${s.buurt}</td><td>${GEBIED[s.gebied]}</td><td class="getal">${fmt(s.capaciteit)}</td>
        <td><span class="staaf" style="width:${Math.min(s.druk, 140).toFixed(0)}px"></span>${fmt(s.druk, 1)}%${RAYON.has(s.gebied) ? "" : ' <span class="toel">werkdagavond</span>'}</td>
        <td class="getal">${s.geteld} van ${s.delen} ${s.delen === 1 ? "deel" : "delen"}${s.volledig ? "" : " <span class=\"toel\">deels</span>"}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function parkeerdrukTelling() {
  const per = Object.fromEntries(ALLE_GEBIEDEN.map((g) => [g.code, drukPerGebied(g.code)]));
  const nachten = P.tellingen.filter((t) => t.metingen.some((m) => m.soort === "werkdagnacht"));
  const zonderNacht = P.tellingen.filter((t) => !t.maatgevend);
  const avond = P.tellingen.filter((t) => t.maatgevend === "werkdagavond");
  const nachtDruk = (t) => t.metingen.find((m) => m.soort === "werkdagnacht").druk;
  const nachtDrukst = nachten.filter((t) => t.metingen.every((m) => (m.druk ?? 0) <= nachtDruk(t)));
  const alle = ALLE_GEBIEDEN.flatMap((g) => per[g.code].geteld).sort((a, b) => b.druk - a.druk);
  const hoog = alle.filter((s) => s.druk > 85);
  return `${strip(ALLE_GEBIEDEN.map((g) => {
      const p = per[g.code];
      const extra = !RAYON.has(g.code);
      if (!p.geteld.length) return ["–", `geen werkdagnachttelling in ${g.naam}`, `0 van ${p.totaal} subbuurten geteld`];
      return [`${p.boven.length} van ${p.geteld.length}`, `getelde subbuurten in ${g.naam} boven 90% op de ${extra ? "werkdagavond" : "werkdagnacht"}`, `${p.geteld.length} van ${p.totaal} geteld · ${p.tussen.length} tussen 85% en 90%${extra ? ` · ${EXTRA.find((x) => x.code === g.code).toelichting}` : ""}`];
    }))}
    <h4 style="margin-top:18px">Gemeten parkeerdruk per subbuurtdeel</h4>
    <p style="font-size:13.5px">De werkdagnacht is maatgevend: dan staan de auto’s van bewoners thuis. In ${nachtDrukst.length} van de ${nachten.length} tellingen die dat moment meten, is het ook het drukste moment (tabel hieronder). ${avond.map((t) => `${t.naam} heeft geen werkdagnacht; daar telt de werkdagavond (${t.metingen.find((m) => m.soort === "werkdagavond").tijd}).`).join(" ")} ${zonderNacht.map((t) => t.naam).join(" en ")} ${zonderNacht.length === 1 ? "heeft" : "hebben"} geen van beide; die vlakken zijn gearceerd en tellen niet mee.</p>
    ${parkeerdrukKaart()}
    <h4 style="margin-top:22px">Welk moment is maatgevend?</h4>
    <p style="font-size:13.5px">Per telling de druk op elk meetmoment. Vet is het maatgevende moment.</p>
    ${tellingenTabel()}
    <h4 style="margin-top:22px">${hoog.length} getelde subbuurten boven 85%</h4>
    <p style="font-size:13.5px">Subbuurt = som van zijn getelde delen. ‘Deels’: niet elk subbuurtdeel met parkeerplaatsen is geteld, dus het cijfer geldt voor een deel van de subbuurt. Een subbuurt met weinig plekken springt snel boven 100%.</p>
    ${subbuurtDrukTabel(hoog)}
    <details><summary>Alle ${alle.length} getelde subbuurten</summary>${subbuurtDrukTabel(alle)}</details>
    <div class="foot">${P.bron}. Rekenregel: ${P.regel}. Maatgevend moment: de ${P.maatgevend}. Alleen subbuurten met woonadressen tellen mee in de getallen hierboven; de kaart toont alle subbuurtdelen. Bouwen met <code>scripts/bouw_parkeerdruk.py</code>.</div>`;
}

function sectorKaart() {
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(P.subbuurtdelen, W);
  const pad = padVan(xy);
  const ps = D.parkeren.sectoren;
  const rij = Object.fromEntries(ps.rijen.map((r) => [r.id, r]));
  const titel = (s) => {
    const v = rij[s.id] && rij[s.id].bezetting;
    return `Sector ${s.id}: ${v == null ? "geen cijfers in de datalade" : `vergunningen ÷ capaciteit ${fmt(v, 1)}%`}${s.nachtdruk == null ? "" : `; geteld op de werkdagnacht ${fmt(s.nachtdruk, 1)}%`}`;
  };
  const koepels = P.sectoren.filter(overkoepelend);
  const eigen = P.sectoren.filter((s) => !overkoepelend(s));
  const vlakken = eigen
    .map((s) => {
      const v = rij[s.id] && rij[s.id].bezetting;
      return `<path d="${pad(s.geometrie)}" fill="${v == null ? "url(#sk-arcering)" : drukKleur(v)}" style="stroke:var(--asfalt);stroke-width:1"><title>${titel(s)}</title></path>`;
    })
    .join("");
  const lijnen = koepels
    .map((s) => `<path d="${pad(s.geometrie)}" style="fill:none;stroke:var(--asfalt);stroke-width:1.4;stroke-dasharray:5 3;pointer-events:none"/>`)
    .join("");
  const sectoren = `<g clip-path="url(#sk-rayon)">${lijnen}${vlakken}</g>`;
  const labels = sectorLabels(eigen, xy);
  const opKaart = new Set(P.sectoren.map((s) => s.id));
  const ongeteld = ps.rijen.filter((r) => r.bezetting > 90 && P.sectoren.some((s) => s.id === r.id && s.nachtdruk == null));
  const advies = ongeteld.length
    ? ` ${ongeteld.map((r, i) => `${i ? "sector" : "Sector"} ${r.id} (${r.gebieden.map((c) => GEBIED[c]).join(", ")}, ${fmt(r.bezetting, 1)}%)`).join(" en ")} ${ongeteld.length === 1 ? "zit" : "zitten"} boven 90%, maar ${ongeteld.length === 1 ? "is" : "zijn"} niet geteld: daar voegt een telling het meest toe.`
    : "";
  const nietOpKaart = [...ps.rijen.map((r) => r.id), ...ps.zonderCijfers].filter((id) => !opKaart.has(id));
  return `<h4 style="margin-top:22px">De parkeersectoren op de kaart</h4>
    <p style="font-size:13.5px">Wat er al lag, nu met de sectorgrenzen: vergunningen ÷ capaciteit per sector, in dezelfde stappen als de telling. Dat is een papieren bezetting, geen telling.${advies}</p>
    <div class="legenda-rij"><b>Vergunningen ÷ capaciteit</b>${drukLegenda(`<span><i style="background:${ARCERING}"></i>geen cijfers</span>${koepels.length ? `<span><i style="border:1.5px dashed var(--asfalt);background:transparent"></i>sector ${koepels.map((s) => s.id).join(" en ")} (omvat de andere, geen cijfers)</span>` : ""}`)}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de parkeersectoren in het rayon, gekleurd naar vergunningen gedeeld door capaciteit">${arceerPatroon("sk-arcering")}${rayonKnip("sk-rayon", pad)}${ondergrond}${sluier(P.subbuurtdelen, pad, W, hoogte)}${sectoren}${labels}${gebiedLabels(P.subbuurtdelen, xy)}${bronvermelding(W, hoogte)}</svg>
    <div class="foot">Sectorgrenzen: ParkeerSectoren (shapefile, handmatig aangeleverd). Op de kaart staat een sector als het middelpunt van minstens één subbuurtdeel van het rayon erin ligt, afgeknipt op de rayongrens. ${nietOpKaart.length ? `Wel in de datalade, niet op de kaart: ${nietOpKaart.join(", ")} (geen vlak in de shapefile, of geen subbuurtdeel van het rayon erin).` : ""} Cijfers: ${ps.bron}; bron: ${bronDatalade()}.</div>`;
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

/* ---------- rapportcijfer ---------- */

// Oplopend van onvoldoende naar goed: één tint, onvoldoende als donkerste grijs zodat het
// aandeel ontevredenen het eerst opvalt. Geen rood: het rapportcijfer kent een norm, de
// verdeling niet.
const RC_KLEUR = ["var(--asfalt-zacht)", "color-mix(in srgb, var(--schie) 30%, var(--wit))", "color-mix(in srgb, var(--schie) 62%, var(--wit))", "var(--schie)"];
const RC_TEKST = ["#fff", "var(--asfalt)", "var(--asfalt)", "#fff"];

function rapportcijfer() {
  const rij = (naam, v, n, extra) => `<div style="display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center;margin:6px 0">
      <span style="font-size:13.5px">${naam}<div class="toel">n = ${fmt(n)}${extra || ""}</div></span>
      <div style="display:flex;height:24px;font-size:11.5px;font-weight:700">${RC.klassen
        .map((k, i) => `<span title="${k}: ${v[k]}%" style="width:${v[k]}%;background:${RC_KLEUR[i]};color:${RC_TEKST[i]};display:flex;align-items:center;justify-content:center;overflow:hidden">${v[k] >= 6 ? v[k] + "%" : ""}</span>`)
        .join("")}</div></div>`;
  const legenda = RC.klassen.map((k, i) => `<span><i style="background:${RC_KLEUR[i]}"></i>${k.toLowerCase()}</span>`).join("");
  const g = F.gebieden.map((x) => ({ ...x, ...RC.gebieden[x.code] }));
  return `${strip(g.map((x) => [fmt(x.cijfer, 1), `rapportcijfer in ${x.naam}`, `${x.onvoldoende}% onvoldoende · n = ${fmt(x.n)}${x.indicatief ? " · indicatief" : ""}`]))}
    <h4 style="margin-top:18px">Verdeling van het oordeel</h4>
    <p style="font-size:13.5px">Het gemiddelde verbergt verdeeldheid: in ${g.reduce((a, b) => (b.onvoldoende > a.onvoldoende ? b : a)).naam} geeft ${g.reduce((a, b) => (b.onvoldoende > a.onvoldoende ? b : a)).onvoldoende}% een onvoldoende. Rotterdam als geheel ter vergelijking.</p>
    <div class="legenda-rij">${legenda}</div>
    ${g.map((x) => rij(x.naam, x.verdeling, x.n, x.indicatief ? " · indicatief" : "")).join("")}
    <div style="display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center;margin:6px 0;color:var(--asfalt-zacht)"><span style="font-size:13.5px">Rotterdam<div class="toel">n = ${fmt(RC.rotterdam.n)}</div></span><span style="font-size:13.5px">${fmt(RC.rotterdam.cijfer, 1)} · ${RC.rotterdam.onvoldoende}% onvoldoende</span></div>
    <div class="foot">${RC.bron}, ${RC.periode}. ${RC.regel[0].toUpperCase() + RC.regel.slice(1)}. Rayon, gewogen naar respondenten: ${fmt(RC.rayon.cijfer, 1)}, ${RC.rayon.onvoldoende}% onvoldoende, n = ${fmt(RC.rayon.n)}; ter informatie, het overzicht toont per gebied. Bouwen met <code>scripts/bouw_rapportcijfer.py</code>.</div>`;
}

/* ---------- ruimtebeslag ---------- */

const RB_GRENZEN = [5, 10, 15, 20];
const RB_LABELS = ["tot 5%", "5–10%", "10–15%", "15–20%", "20% en meer"];
const rbKleur = (v) => `color-mix(in srgb, var(--schie) ${DRUK_TINT[RB_GRENZEN.filter((g) => v >= g).length]}%, var(--wit))`;
const ha = (m2) => fmt(m2 / 1e4, 1);

// Som over som per gebied; noemer naar keuze met of zonder grote parken van `grens` ha.
function rbGebied(code, grens) {
  const woon = new Set(D.parkeren.subbuurten.kaart.map((k) => k.code));
  const sb = RB.subbuurten.filter((s) => s.gebied === code && woon.has(s.code));
  const met = sb.filter((s) => s.aandeel != null);
  const noemer = (s) => (grens == null ? s.openbaarBruto : s.openbaarBruto - s.inPark[String(grens)]);
  const teller = met.reduce((a, s) => a + s.parkeren, 0), onder = met.reduce((a, s) => a + noemer(s), 0);
  return { sb, met, teller, onder, aandeel: onder ? (100 * teller) / onder : null, plekken: met.reduce((a, s) => a + s.plekken, 0) };
}

function ruimtebeslagKaart() {
  const W = 800;
  const rayon = P.subbuurtdelen.filter((d) => RAYON.has(d.gebied));
  const { xy, hoogte, ondergrond } = projectie(rayon, W);
  const pad = padVan(xy);
  const geo = Object.fromEntries(P.subbuurtdelen.map((d) => [d.code, d.geometrie]));
  const sb = Object.fromEntries(RB.subbuurten.map((s) => [s.code, s]));
  const paden = RB.subbuurtdelen
    .map((d) => {
      const s = sb[d.subbuurt];
      const titel = s.aandeel == null ? `${d.buurt}, subbuurt ${s.code}: geen cijfer` : `${d.buurt}, subbuurt ${s.code}: ${fmt(s.aandeel, 1)}% (${fmt(s.plekken)} plekken, ${ha(s.parkeren)} ha parkeren op ${ha(s.openbaar)} ha openbare ruimte). Dit deel: ${d.bron === "telling" ? "capaciteit uit de telling" : "BGT-parkeervlakken"}`;
      return `<path d="${pad(geo[d.code])}" fill="${s.aandeel == null ? "var(--beton-diep)" : rbKleur(s.aandeel)}"><title>${titel}</title></path>`;
    })
    .join("");
  // Gestippeld: dit deel komt uit de BGT, niet uit een telling.
  const bgt = RB.subbuurtdelen
    .filter((d) => d.bron === "bgt")
    .map((d) => `<path d="${pad(geo[d.code])}" fill="url(#rb-bgt)" style="fill-opacity:1;stroke:none;pointer-events:none"/>`)
    .join("");
  const stip = `<defs><pattern id="rb-bgt" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="0.9" fill="var(--asfalt)" fill-opacity=".55"/></pattern></defs>`;
  const legenda =
    RB_LABELS.map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${DRUK_TINT[i]}%, var(--wit))"></i>${t}</span>`).join("") +
    `<span><i style="background:radial-gradient(circle, var(--asfalt) 0 1px, transparent 1.2px) 0 0/5px 5px"></i>deel uit BGT, niet geteld</span><span><i style="background:var(--beton-diep)"></i>geen cijfer</span>`;
  return `<div class="legenda-rij"><b>Parkeren ÷ openbare ruimte</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurten met het ruimtebeslag van parkeren">${stip}${ondergrond}${sluier(rayon, pad, W, hoogte)}${paden}${bgt}${gebiedLabels(rayon, xy)}${bronvermelding(W, hoogte)}</svg>`;
}

function ruimtebeslag() {
  const per = Object.fromEntries(F.gebieden.map((g) => [g.code, rbGebied(g.code, RB.grootPark.ha)]));
  const woon = new Set(D.parkeren.subbuurten.kaart.map((k) => k.code));
  const alle = RB.subbuurten.filter((s) => woon.has(s.code) && s.aandeel != null).sort((a, b) => b.aandeel - a.aandeel);
  const grenzen = [null, ...RB.grootPark.gevoeligheid];
  const tabel = (rijen) => `<div class="scroll"><table class="data" style="min-width:640px"><thead><tr><th>Subbuurt</th><th>Buurt</th><th>Gebied</th><th class="getal">Plekken</th><th class="getal">Parkeren</th><th class="getal">Openbare ruimte</th><th>Ruimtebeslag</th><th>Bron</th></tr></thead><tbody>
    ${rijen
      .map((s) => `<tr><td>${s.code}</td><td>${s.buurt}</td><td>${GEBIED[s.gebied]}</td><td class="getal">${fmt(s.plekken)}</td><td class="getal">${ha(s.parkeren)} ha</td><td class="getal">${ha(s.openbaar)} ha</td>
        <td><span class="staaf" style="width:${Math.min(4 * s.aandeel, 140).toFixed(0)}px"></span>${fmt(s.aandeel, 1)}%</td><td>${{ telling: "telling", bgt: "BGT", mix: "telling + BGT" }[s.bron]}</td></tr>`)
      .join("")}</tbody></table></div>`;
  return `${strip(F.gebieden.map((g) => {
      const p = per[g.code];
      return p.aandeel == null ? ["–", `geen cijfer voor ${g.naam}`, ""] : [`${fmt(p.aandeel)}%`, `van de openbare ruimte in ${g.naam} is parkeervlak`, `${p.met.length} van ${p.sb.length} subbuurten · ${fmt(p.plekken)} plekken`];
    }))}
    <h4 style="margin-top:18px">Ruimtebeslag per subbuurt</h4>
    <p style="font-size:13.5px">Waar geteld is, telt de capaciteit uit de telling: ${fmt(RB.m2PerPlek, 1)} m² per plek. Elders het oppervlak van de BGT-parkeervlakken (gestippeld). Het oppervlak per plek is geijkt op ${RB.ijking.delen} getelde subbuurtdelen: zoveel BGT-parkeervlak ligt er gemiddeld per getelde plek (mediaan ${fmt(RB.ijking.mediaan, 1)}, middelste helft ${fmt(RB.ijking.p25, 1)}–${fmt(RB.ijking.p75, 1)} m²). Zo staan beide bronnen op dezelfde schaal.</p>
    ${ruimtebeslagKaart()}
    <h4 style="margin-top:22px">Hoeveel maakt ‘groot park’ uit?</h4>
    <p style="font-size:13.5px">Grote parken vallen uit de noemer. Nu: aaneengesloten groen vanaf ${fmt(RB.grootPark.ha)} ha, met paden tot ${RB.grootPark.sluitM} m breed als deel van het park. Per grens het ruimtebeslag per gebied:</p>
    <div class="scroll"><table class="data" style="min-width:520px"><thead><tr><th>Groot park vanaf</th>${F.gebieden.map((g) => `<th class="getal">${g.naam}</th>`).join("")}</tr></thead><tbody>
      ${grenzen
        .map((gr) => `<tr${gr === RB.grootPark.ha ? ' style="font-weight:700"' : ""}><td>${gr == null ? "geen park uitgesloten" : `${fmt(gr, gr < 1 ? 1 : 0)} ha`}</td>${F.gebieden.map((g) => `<td class="getal">${fmt(rbGebied(g.code, gr).aandeel, 1)}%</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>
    <h4 style="margin-top:22px">De 10 subbuurten met het hoogste ruimtebeslag</h4>
    ${tabel(alle.slice(0, 10))}
    <details><summary>Alle ${alle.length} subbuurten met een cijfer</summary>${tabel(alle)}</details>
    <div class="foot">Rekenregel: ${RB.regel}. Teller: ${RB.teller}. Noemer: ${RB.noemer}. Alleen subbuurten met woonadressen tellen mee in de gebiedscijfers. Bron: ${RB.bron}; BGT © Kadaster, CC-BY 4.0. Ophalen met <code>scripts/haal_bgt.py</code>, bouwen met <code>scripts/bouw_ruimtebeslag.py</code>.</div>`;
}

/* ---------- fietsparkeren ---------- */

// Druk loopt hier ver boven 100%: in woonstraten staan veel fietsen buiten een rek. Daarom
// andere klassegrenzen dan bij auto's; 100% is een klassegrens, geen norm.
const FP_GRENZEN = [50, 75, 100, 150];
const FP_LABELS = ["tot 50%", "50–75%", "75–100%", "100–150%", "150% en meer"];
const fpKleur = (v) => `color-mix(in srgb, var(--schie) ${DRUK_TINT[FP_GRENZEN.filter((g) => v > g).length]}%, var(--wit))`;
const MOMENT_FIETS = { Dinsdagmiddag: "di middag", Dinsdagavond: "di avond", Zaterdagmiddag: "za middag", Zaterdagavond: "za avond" };

function fietsPerGebied(code) {
  const kaart = D.parkeren.subbuurten.kaart.filter((k) => k.gebied === code);
  const woon = new Set(kaart.map((k) => k.code));
  const sb = FP.subbuurten.filter((s) => s.gebied === code && woon.has(s.code));
  const som = (k) => sb.reduce((a, s) => a + s[k], 0);
  return { totaal: kaart.length, sb, cap: som("capaciteit"), fietsen: som("fietsen"), wild: som("wild"), tekort: som("tekort"), boven: sb.filter((s) => s.druk > 100) };
}

function fietsKaart() {
  const kaart = D.parkeren.subbuurten.kaart;
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(kaart, W);
  const pad = padVan(xy);
  const per = Object.fromEntries(FP.subbuurten.map((s) => [s.code, s]));
  const vulling = (s) => (!s ? "var(--beton-diep)" : s.druk == null ? (s.fietsen ? "url(#fp-arcering)" : "var(--beton)") : fpKleur(s.druk));
  const titel = (k, s) => {
    const kop = `Subbuurt ${k.code} (${GEBIED[k.gebied]})`;
    if (!s) return `${kop}: niet geteld`;
    const t = FP.tellingen[s.telling];
    if (s.druk == null) return `${kop}: geen voorzieningen, ${fmt(s.fietsen)} fietsen op straat. ${t.naam} ${t.jaar}, ${MOMENT_FIETS[t.maatgevend]}`;
    return `${kop}: ${fmt(s.druk)}% · ${fmt(s.fietsen)} fietsen op ${fmt(s.capaciteit)} plekken, ${fmt(s.wild)} buiten een voorziening. ${t.naam} ${t.jaar}, ${MOMENT_FIETS[t.maatgevend]}`;
  };
  const paden = kaart.map((k) => `<path d="${pad(k.geometrie)}" fill="${vulling(per[k.code])}"><title>${titel(k, per[k.code])}</title></path>`).join("");
  // Voorzieningen als punt, oppervlak naar capaciteit: laat zien waar de plekken staan.
  const punten = FP.voorzieningen
    .map((v) => {
      const [x, y] = xy([v.lon, v.lat]);
      const r = Math.max(1.2, Math.sqrt(v.capaciteit) * 0.55);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" style="fill:var(--wit);fill-opacity:.85;stroke:var(--asfalt);stroke-width:.6"><title>${v.type}: ${fmt(v.capaciteit)} plekken${v.fietsen == null ? "" : `, ${fmt(v.fietsen)} fietsen op het drukste moment`}</title></circle>`;
    })
    .join("");
  const arcering = `<defs><pattern id="fp-arcering" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--beton-diep)"/><rect width="1.5" height="5" fill="var(--schie)"/></pattern></defs>`;
  const legenda =
    FP_LABELS.map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${DRUK_TINT[i]}%, var(--wit))"></i>${t}</span>`).join("") +
    `<span><i style="background:${ARCERING}"></i>geen voorziening, wel fietsen</span><span><i style="background:var(--beton-diep)"></i>niet geteld</span><span><i style="border-radius:50%;border:1px solid var(--asfalt);background:var(--wit);width:10px"></i>voorziening, grootte naar capaciteit</span>`;
  return `<div class="legenda-rij"><b>Fietsparkeerdruk, drukste moment</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurten met de fietsparkeerdruk en de fietsparkeervoorzieningen">${arcering}${ondergrond}${sluier(kaart, pad, W, hoogte)}${paden}${punten}${gebiedLabels(kaart, xy)}${bronvermelding(W, hoogte)}</svg>`;
}

function fietsTellingen() {
  const max = Math.max(...FP.tellingen.flatMap((t) => t.metingen.map((m) => m.druk ?? 0)));
  const rijen = FP.tellingen
    .map((t) => {
      const cap = t.metingen[0].capaciteit;
      const ms = t.metingen
        .map((m) => {
          const vet = m.moment === t.maatgevend;
          return `<div style="display:grid;grid-template-columns:5.5em 118px 4.2em;gap:8px;align-items:center;${vet ? "font-weight:700" : ""}">
            <span>${MOMENT_FIETS[m.moment]}</span><span><span class="staaf" style="width:${((110 * m.druk) / max).toFixed(0)}px;${vet ? "" : "opacity:.45"}"></span></span><span style="text-align:right">${fmt(m.druk)}%</span></div>`;
        })
        .join("");
      return `<tr><td>${t.naam}<div class="toel">Ecorys ${t.jaar}, ${t.code}</div></td><td>${GEBIED[t.gebied]}</td><td class="getal">${fmt(t.subbuurten)}</td><td class="getal">${fmt(cap)}</td><td>${ms}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="data" style="min-width:640px"><thead><tr><th>Telling</th><th>Gebied</th><th class="getal">Subbuurten</th><th class="getal">Capaciteit</th><th>Druk per meetmoment</th></tr></thead><tbody>${rijen}</tbody></table></div>`;
}

function fietsSubbuurten(rijen) {
  const buurt = Object.fromEntries((P ? P.subbuurtdelen : []).map((d) => [d.subbuurt, d.buurt]));
  return `<div class="scroll"><table class="data" style="min-width:640px"><thead><tr><th>Subbuurt</th><th>Telling</th><th class="getal">Capaciteit</th><th class="getal">Fietsen</th><th class="getal">Waarvan buiten voorziening</th><th>Druk</th><th class="getal">Tekort</th></tr></thead><tbody>
    ${rijen
      .map((s) => `<tr><td>${s.code}<div class="toel">${buurt[s.code] || GEBIED[s.gebied]}</div></td><td>${FP.tellingen[s.telling].naam}</td><td class="getal">${fmt(s.capaciteit)}</td><td class="getal">${fmt(s.fietsen)}</td><td class="getal">${fmt(s.wild)}</td>
        <td>${s.druk == null ? `<span class="toel">geen voorziening</span>` : `<span class="staaf" style="width:${Math.min(s.druk / 3, 140).toFixed(0)}px"></span>${fmt(s.druk)}%`}</td><td class="getal">${fmt(s.tekort)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function fietsparkeren() {
  const per = Object.fromEntries(F.gebieden.map((g) => [g.code, fietsPerGebied(g.code)]));
  const alle = F.gebieden.flatMap((g) => per[g.code].sb);
  const hoog = alle.filter((s) => s.druk > 100 || (s.druk == null && s.fietsen)).sort((a, b) => b.tekort - a.tekort);
  const zonder = alle.filter((s) => s.druk == null && s.fietsen);
  const tot = alle.reduce((a, s) => a + s.capaciteit, 0);
  return `${strip(F.gebieden.map((g) => {
      const p = per[g.code];
      if (!p.sb.length) return ["–", `geen fietsparkeertelling in ${g.naam}`, `0 van ${p.totaal} subbuurten geteld`];
      return [`${fmt((100 * p.fietsen) / p.cap)}%`, `fietsparkeerdruk in ${g.naam}: ${fmt(p.fietsen)} fietsen op ${fmt(p.cap)} plekken`, `${p.boven.length} van ${p.sb.length} subbuurten boven 100% · tekort ${fmt(p.tekort)} plekken`];
    }))}
    <h4 style="margin-top:18px">Capaciteit en druk per subbuurt</h4>
    <p style="font-size:13.5px">${fmt(tot)} plekken in ${fmt(FP.voorzieningen.length)} voorzieningen. De druk telt alle fietsen op straat, ook die buiten een rek staan. Daardoor ligt hij vaak boven 100% terwijl de rekken zelf niet vol zijn. ${zonder.length} getelde subbuurten hebben geen enkele voorziening, maar wel fietsen op straat (gearceerd).</p>
    ${fietsKaart()}
    <h4 style="margin-top:22px">Welk moment is het drukst?</h4>
    <p style="font-size:13.5px">Per telling de druk op de vier meetmomenten. Vet is het drukste moment; dat telt.</p>
    ${fietsTellingen()}
    <h4 style="margin-top:22px">${hoog.length} subbuurten boven 100% of zonder voorziening: de 15 met het grootste tekort</h4>
    <p style="font-size:13.5px">Tekort = fietsen min plekken op het drukste moment: zoveel plekken zijn er nodig om elke fiets een plek te geven. Samen ${fmt(hoog.reduce((a, s) => a + s.tekort, 0))} plekken.</p>
    ${fietsSubbuurten(hoog.slice(0, 15))}
    <details><summary>Alle ${alle.length} getelde subbuurten</summary>${fietsSubbuurten([...alle].sort((a, b) => a.code.localeCompare(b.code)))}</details>
    <div class="foot">${FP.bron}. Rekenregel: ${FP.regel}. Maatgevend: ${FP.maatgevend}. Alleen subbuurten met woonadressen tellen mee in de gebiedscijfers. Bouwen met <code>scripts/bouw_fietsparkeren.py</code>.</div>`;
}

const ontbreektBestand = (bestand, script) =>
  `<div class="nodig"><b>Niet geladen</b><code>${bestand}</code> ontbreekt. Bouw het met <code>uv run ${script}</code>.</div>`;

const VISUEEL = {
  "bezetting-fietsparkeren": () => (FP ? veilig("fietsparkeren", fietsparkeren) : ontbreektBestand("data/fietsparkeren.js", "scripts/bouw_fietsparkeren.py")),
  "beleving-parkeren": () => (RC ? veilig("rapportcijfer", rapportcijfer) : ontbreektBestand("data/rapportcijfer.js", "scripts/bouw_rapportcijfer.py")),
  "ruimtebeslag-parkeren": () =>
    RB && P ? veilig("ruimtebeslag", ruimtebeslag) : ontbreektBestand(RB ? "data/parkeerdruk.js" : "data/ruimtebeslag.js", RB ? "scripts/bouw_parkeerdruk.py" : "scripts/bouw_ruimtebeslag.py"),
  "parkeerdruk-subbuurt": () =>
    (P
      ? veilig("parkeerdruk-telling", parkeerdrukTelling)
      : `<div class="nodig"><b>Geen tellingen geladen</b><code>data/parkeerdruk.js</code> ontbreekt. Bouw het met <code>uv run scripts/bouw_parkeerdruk.py</code>.</div>`) +
    veilig("autobezit-subbuurt", subbuurtKaart) +
    (P ? veilig("sectoren-kaart", sectorKaart) : "") +
    sectorTabel(),
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
