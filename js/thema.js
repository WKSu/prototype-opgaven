// Themaviewer: per indicator wat de gepubliceerde datalade nu kan beantwoorden.
// Redactie (vraag, meting, let op, wat ontbreekt) komt uit FUNCTIONEREN in data/indicatoren.js;
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
// Context voor parkeren, geen indicator: woningbouwprognose (BoPro) en P+R-capaciteit (NPR).
const WB = typeof WONINGBOUW !== "undefined" ? WONINGBOUW : null;
const PRR = typeof PR !== "undefined" ? PR : null;
const THEMA = F && F.themas.find((t) => t.sleutel === document.body.dataset.thema);
// Extra gebieden (de Spaanse Polder) staan in de parkeertelling, niet in het rayon: wel op de
// kaart en in de tabellen, niet in de gebiedscijfers van het overzicht.
const EXTRA = P && P.extraGebieden ? P.extraGebieden : [];
const ALLE_GEBIEDEN = [...(F ? F.gebieden : []), ...EXTRA];
const RAYON = new Set(F ? F.gebieden.map((g) => g.code) : []);
const GEBIED = Object.fromEntries(ALLE_GEBIEDEN.map((g) => [g.code, g.naam]));
// Alleen wat nog niet volledig is, krijgt een label; een volledig cijfer heeft er geen nodig.
const STATUS = { ja: "", deels: "Deels beschikbaar", nee: "Nog niet beschikbaar" };

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
const statusChip = (st) => (STATUS[st] ? `<span class="oordeel o-${st}">${STATUS[st]}</span>` : "");
const strip = (cellen) =>
  `<div class="strip">${cellen
    .map(([n, l, src]) => `<div class="cell"><div class="num">${n}</div><div class="lbl">${l}</div>${src ? `<div class="src">${src}</div>` : ""}</div>`)
    .join("")}</div>`;
const kort = (sha) => sha.slice(0, 7);
const bronDatalade = () => "datalade gebiedsplannen";
const bronLoop = () => "OV-verkenner Invloedsgebied ov-haltes";
// Waar de OV-cijfers vandaan komen, in één zin voor onder een blok.
const ovBron = () => `Bron: dienstregeling van een werkdag (GTFS), BAG-adressen en looproutes (OpenStreetMap), via de ${bronLoop()}.`;

/* ---------- parkeren ---------- */

// Buurtnaam bij een subbuurtcode, voor het label op de kaart; uit de parkeertellingen.
const buurtVan = (code) => {
  const d = P && P.subbuurtdelen.find((x) => x.subbuurt === code);
  return d ? d.buurt : null;
};

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
    .map((f) => `<path d="${pad(f.geometrie)}" data-koppel="${sleutel("subbuurt", f.code)}" fill="${kleur(f.autosPerWoonadres)}"><title>${buurtVan(f.code) || f.naam}, subbuurt ${f.naam} (${GEBIED[f.gebied]}): ${f.autosPerWoonadres == null ? "onbekend" : fmt(f.autosPerWoonadres, 2) + " auto’s per woonadres"}, ${fmt(f.woonadressen)} woonadressen</title></path>`)
    .join("");
  const labels = gebiedLabels(sb.kaart, xy);
  const legenda = ["< 0,6", "0,6–0,8", "0,8–1,0", "1,0–1,2", "≥ 1,2"]
    .map((t, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${tint[i]}%, var(--wit))"></i>${t}</span>`)
    .join("") + `<span><i style="background:var(--beton-diep)"></i>onbekend</span>`;
  const n = sb.aantalPerGebied;
  return `<h4 style="margin-top:18px">Autobezit per subbuurt</h4>
    <p style="font-size:13.5px">Auto’s per woonadres in ${F.gebieden.map((g) => `${n[g.code]} subbuurten in ${g.naam}`).join(", ")}: de vraag naar parkeerplekken, niet de druk. Veel auto’s per adres en een volle straat versterken elkaar.</p>
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
  return `<h4 style="margin-top:22px">Vergunningen per parkeersector</h4>
    <p style="font-size:13.5px">Per sector het aantal vergunningen gedeeld door het aantal plekken: een bezetting op papier, geen telling. ${boven.length} van de ${metCijfers.length} sectoren met cijfers komen op papier boven 90%; de scanauto meet nergens meer dan ${fmt(scanMax)}%. De laatste kolom is wel een telling, op de werkdagnacht.</p>
    <div class="scroll"><table class="data" style="min-width:720px"><thead><tr>
      <th>Sector</th><th>Gebied</th><th class="getal">Deel in rayon</th><th class="getal">Capaciteit</th>
      <th class="getal">Vergunningen</th><th class="getal">Vergunningen ÷ capaciteit</th><th class="getal">Scanbezetting</th><th class="getal">Telling, nacht</th></tr></thead><tbody>
      ${ps.rijen
        .map((r) => `<tr data-koppel="${sleutel("sector", r.id)}"><td>${r.id}</td><td>${gebieden(r)}</td><td class="getal">${fmt(r.deelInRayon)}%</td><td class="getal">${fmt(r.capaciteit)}</td>
          <td class="getal">${r.capaciteit == null ? "–" : fmt((r.vergunningenBewoners ?? 0) + (r.vergunningenBedrijven ?? 0))}</td>
          <td class="getal">${r.bezetting == null ? "–" : fmt(r.bezetting, 1) + "%"}</td><td class="getal">${r.bezettingScan == null ? "–" : fmt(r.bezettingScan, 1) + "%"}</td><td class="getal">${nacht(r.id)}</td></tr>`)
        .join("")}</tbody></table></div>
    <div class="foot">${ps.bron}. Vergunningen ÷ capaciteit = ${ps.bezettingRegel}. ${ps.scanCaveat} ${ps.caveat} Sectoren zonder cijfers: ${ps.zonderCijfers.join(", ")}. Bron: ${bronDatalade()}${P ? `; telling: ${P.bron}` : ""}.</div>`;
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
    if (d.hoogste) return `${kop}: geen maatgevend moment geteld. Hoogste meting ${fmt(d.hoogste.druk, 1)}% (${MOMENT[d.hoogste.soort]}). ${t}`;
    return `${kop}: geteld, maar geen openbare parkeerplaatsen. ${t}`;
  };
  const koppelDeel = (d) => [sleutel("subbuurt", d.subbuurt), sleutel("deel", d.code), d.telling != null ? sleutel("telling", d.telling) : ""].join(" ").trim();
  const paden = P.subbuurtdelen.map((d) => `<path d="${pad(d.geometrie)}" data-koppel="${koppelDeel(d)}" fill="${vulling(d)}"><title>${titel(d)}</title></path>`).join("");
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
    `<span><i style="background:${ROOD_ARCERING};border-color:var(--rood)"></i>subbuurt boven 90%: norm overschreden</span><span><i style="background:${ARCERING}"></i>geteld, geen maatgevend moment</span><span><i style="background:var(--beton)"></i>geteld, geen plekken</span><span><i style="background:var(--beton-diep)"></i>niet geteld</span><span><i style="border:1.5px dashed var(--asfalt);background:transparent"></i>parkeersector</span>`
  );
  return `<div class="legenda-rij"><b>Bruto parkeerdruk, werkdagnacht</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de subbuurtdelen met de gemeten parkeerdruk op de werkdagnacht">${arceerPatroon("pd-arcering")}${roodPatroon("pd-rood")}${rayonKnip("pd-rayon", pad)}${ondergrond}${sluier(P.subbuurtdelen, pad, W, hoogte)}${paden}${rood}${sectoren}${gebiedLabels(P.subbuurtdelen, xy)}${bronvermelding(W, hoogte)}</svg>`;
}

function tellingenTabel() {
  const max = Math.max(...P.tellingen.flatMap((t) => t.metingen.map((m) => m.druk ?? 0)));
  const rijen = P.tellingen
    .map((t, ti) => {
      const ms = t.metingen
        .map((m) => {
          const nacht = t.maatgevendMetingen.includes(m.id);
          const w = m.druk == null ? 0 : (110 * m.druk) / max;
          return `<div style="display:grid;grid-template-columns:1fr 118px 4.2em;gap:8px;align-items:center;${nacht ? "font-weight:700" : ""}">
            <span>${m.id} · ${m.dag.toLowerCase()} ${m.tijd} · ${MOMENT[m.soort]}</span>
            <span><span class="staaf" style="width:${w.toFixed(0)}px;${nacht ? "" : "opacity:.45"}"></span></span><span style="text-align:right">${m.druk == null ? "–" : fmt(m.druk, 1) + "%"}</span></div>`;
        })
        .join("");
      return `<tr data-koppel="${sleutel("telling", ti)}"><td>${t.naam}<div class="toel">${t.bureau}, ${t.code}</div></td><td>${t.gebieden.map((c) => GEBIED[c]).join(", ")}</td><td class="getal">${fmt(t.subbuurtdelen)}</td><td>${ms}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="data" style="min-width:680px"><thead><tr><th>Telling</th><th>Gebied</th><th class="getal">Subbuurtdelen</th><th>Druk per meting, over de getelde subbuurtdelen in de analyse</th></tr></thead><tbody>${rijen}</tbody></table></div>`;
}

function subbuurtDrukTabel(rijen) {
  return `<div class="scroll"><table class="data" style="min-width:600px"><thead><tr><th>Subbuurt</th><th>Buurt</th><th>Gebied</th><th class="getal">Plekken</th><th>Druk</th><th class="getal">Geteld</th></tr></thead><tbody>
    ${rijen
      .map((s) => `<tr data-koppel="${sleutel("subbuurt", s.code)}"><td>${s.code}</td><td>${s.buurt}</td><td>${GEBIED[s.gebied]}</td><td class="getal">${fmt(s.capaciteit)}</td>
        <td><span class="staaf" style="width:${Math.min(s.druk, 140).toFixed(0)}px"></span>${fmt(s.druk, 1)}%${RAYON.has(s.gebied) ? "" : ` <span class="toel">${MOMENT[(P.subbuurtdelen.find((d) => d.gebied === s.gebied && d.moment) || {}).moment] || ""}</span>`}</td>
        <td class="getal">${s.geteld} van ${s.delen} ${s.delen === 1 ? "deel" : "delen"}${s.volledig ? "" : " <span class=\"toel\">deels</span>"}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function parkeerdrukTelling() {
  const per = Object.fromEntries(ALLE_GEBIEDEN.map((g) => [g.code, drukPerGebied(g.code)]));
  const nachten = P.tellingen.filter((t) => t.metingen.some((m) => m.soort === "werkdagnacht"));
  const zonderNacht = P.tellingen.filter((t) => !t.maatgevend);
  const anders = P.tellingen.filter((t) => t.maatgevend && t.maatgevend !== "werkdagnacht");
  // Moment per extra gebied, uit zijn subbuurtdelen: daar is het niet de werkdagnacht.
  const momentVan = (code) => (P.subbuurtdelen.find((d) => d.gebied === code && d.moment) || {}).moment;
  const nachtDruk = (t) => t.metingen.find((m) => m.soort === "werkdagnacht").druk;
  const nachtDrukst = nachten.filter((t) => t.metingen.every((m) => (m.druk ?? 0) <= nachtDruk(t)));
  const alle = ALLE_GEBIEDEN.flatMap((g) => per[g.code].geteld).sort((a, b) => b.druk - a.druk);
  const hoog = alle.filter((s) => s.druk > 85);
  return `${strip(ALLE_GEBIEDEN.map((g) => {
      const p = per[g.code];
      const extra = !RAYON.has(g.code);
      if (!p.geteld.length) return ["–", `geen werkdagnachttelling in ${g.naam}`, `0 van ${p.totaal} subbuurten geteld`];
      return [`${p.boven.length} van ${p.geteld.length}`, `getelde subbuurten in ${g.naam} boven 90% op de ${extra ? MOMENT[momentVan(g.code)] : "werkdagnacht"}`, `${p.geteld.length} van ${p.totaal} geteld · ${p.tussen.length} tussen 85% en 90%${extra ? ` · ${EXTRA.find((x) => x.code === g.code).toelichting}` : ""}`];
    }))}
    <h4 style="margin-top:18px">Parkeerdruk op de kaart</h4>
    <p style="font-size:13.5px">Het moment dat telt is de werkdagnacht: dan staan de auto’s van bewoners thuis. In ${nachtDrukst.length} van de ${nachten.length} tellingen is dat ook het drukste moment. ${anders.map((t) => { const m = t.metingen.find((x) => t.maatgevendMetingen.includes(x.id)); return `${t.naam} is een bedrijventerrein zonder werkdagnacht; daar telt de ${m.dag.trim().toLowerCase()}middag (${m.tijd}), als het er het drukst is.`; }).join(" ")} ${zonderNacht.map((t) => t.naam).join(" en ")} ${zonderNacht.length === 1 ? "heeft" : "hebben"} geen van beide; die vlakken zijn gearceerd en tellen niet mee. Rood gearceerd: een subbuurt boven 90%.</p>
    ${parkeerdrukKaart()}
    <h4 style="margin-top:22px">Druk per meetmoment</h4>
    <p style="font-size:13.5px">Per telling de druk op elk meetmoment. Vet is het moment dat telt.</p>
    ${tellingenTabel()}
    <h4 style="margin-top:22px">${hoog.length} getelde subbuurten boven 85%</h4>
    <p style="font-size:13.5px">Een subbuurt is de som van zijn getelde delen. ‘Deels’: niet alle delen met parkeerplekken zijn geteld. Met weinig plekken komt een subbuurt snel boven 100%.</p>
    ${subbuurtDrukTabel(hoog)}
    <details><summary>Alle ${alle.length} getelde subbuurten</summary>${subbuurtDrukTabel(alle)}</details>
    <div class="foot">${P.bron}. Rekenregel: ${P.regel}. Maatgevend moment: de ${P.maatgevend}. Alleen subbuurten met woonadressen tellen mee in de getallen hierboven; de kaart toont alle subbuurtdelen.</div>`;
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
      return `<path d="${pad(s.geometrie)}" data-koppel="${sleutel("sector", s.id)}" fill="${v == null ? "url(#sk-arcering)" : drukKleur(v)}" style="stroke:var(--asfalt);stroke-width:1"><title>${titel(s)}</title></path>`;
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
  return `<h4 style="margin-top:22px">Vergunningen per sector op de kaart</h4>
    <p style="font-size:13.5px">Vergunningen gedeeld door plekken per sector, in dezelfde kleuren als de telling. Een bezetting op papier, geen telling.${advies}</p>
    <div class="legenda-rij"><b>Vergunningen ÷ capaciteit</b>${drukLegenda(`<span><i style="background:${ARCERING}"></i>geen cijfers</span>${koepels.length ? `<span><i style="border:1.5px dashed var(--asfalt);background:transparent"></i>sector ${koepels.map((s) => s.id).join(" en ")} (omvat de andere, geen cijfers)</span>` : ""}`)}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van de parkeersectoren in het rayon, gekleurd naar vergunningen gedeeld door capaciteit">${arceerPatroon("sk-arcering")}${rayonKnip("sk-rayon", pad)}${ondergrond}${sluier(P.subbuurtdelen, pad, W, hoogte)}${sectoren}${labels}${gebiedLabels(P.subbuurtdelen, xy)}${bronvermelding(W, hoogte)}</svg>
    <div class="foot">Sectorgrenzen van de gemeente, afgeknipt op de rayongrens. ${nietOpKaart.length ? `Niet op de kaart: sector ${nietOpKaart.join(", ")} (geen grens bekend, of buiten het rayon).` : ""} Cijfers: ${ps.bron}; ${bronDatalade()}.</div>`;
}

function wachtlijstTabel() {
  const ps = D.parkeren.sectoren;
  const rijen = ps.rijen.filter((r) => r.plafond != null);
  return `<div class="scroll"><table class="data" style="min-width:520px"><thead><tr>
      <th>Sector</th><th>Gebied</th><th class="getal">Plafond</th><th class="getal">Vergunningen bewoners</th>
      <th class="getal">Wachtlijst bewoners</th><th class="getal">Wachtlijst bedrijven</th></tr></thead><tbody>
      ${rijen
        .map((r) => `<tr data-koppel="${sleutel("sector", r.id)}"><td>${r.id}</td><td>${r.gebieden.map((c) => GEBIED[c]).join(", ")}</td><td class="getal">${fmt(r.plafond)}</td>
          <td class="getal">${fmt(r.vergunningenBewoners)}</td><td class="getal">${fmt(r.wachtlijstBewoners)}</td><td class="getal">${fmt(r.wachtlijstBedrijven)}</td></tr>`)
        .join("")}</tbody></table></div>
    <div class="foot">Aantal wachtenden op de peildatum, geen wachttijd. ${ps.bron}; ${bronDatalade()}.</div>`;
}

/* ---------- OV ---------- */

const ov = (code) => D.ov.perGebied[code];

/* ---------- OV-normen en buurtkaarten ---------- */

// Stand van de schuifjes; begint op de standaardnorm uit FUNCTIONEREN.ovKeuzes.
const S_OV = F ? { ...F.ovKeuzes } : {};
// Interactieve blokken binden hun schuifjes nadat de pagina is opgebouwd.
const NA_RENDER = [];

const alleBuurten = () => F.gebieden.flatMap((g) => ov(g.code).buurten.map((b) => ({ ...b, gebied: g.code })));
const alleHaltes = () => F.gebieden.flatMap((g) => ov(g.code).haltes);
const pctVan = (deel, geheel) => (geheel ? (100 * deel) / geheel : null);

// Eén tint van licht naar donker, zoals de parkeerkaarten: een grootte, geen oordeel.
function klassen(grenzen, labels) {
  const tint = (v) => DRUK_TINT[grenzen.filter((g) => v >= g).length];
  return {
    kleur: (v) => (v == null ? "var(--beton-diep)" : `color-mix(in srgb, var(--schie) ${tint(v)}%, var(--wit))`),
    legenda: labels.map((l, i) => `<span><i style="background:color-mix(in srgb, var(--schie) ${DRUK_TINT[i]}%, var(--wit))"></i>${l}</span>`).join(""),
  };
}
const DEKKING_KL = klassen([50, 70, 85, 95], ["tot 50%", "50–70%", "70–85%", "85–95%", "95% en meer"]);
const AANDEEL_KL = klassen([10, 30, 50, 70], ["tot 10%", "10–30%", "30–50%", "50–70%", "70% en meer"]);
const VERLIES_KL = klassen([5, 15, 30, 60], ["tot 5%", "5–15%", "15–30%", "30–60%", "60% en meer"]);

// Kaart per buurt. De vlakken dragen data-buurt, zodat een schuifje alleen de kleur en de
// hovertekst bijwerkt (kleurKaart) en de PDOK-ondergrond niet opnieuw laadt.
function buurtKaart(id, titel, kl, waarde, hover, extra = () => "") {
  const bs = alleBuurten();
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(bs, W);
  const pad = padVan(xy);
  const paden = bs
    .map((b) => `<path d="${pad(b.geometrie)}" data-buurt="${attr(b.naam)}" data-koppel="${sleutel("buurt", b.naam)}" fill="${kl.kleur(waarde(b))}" data-tip="${attr(hover(b, waarde(b)))}"></path>`)
    .join("");
  return `<div class="legenda-rij"><b>${titel}</b>${kl.legenda}</div>
    <svg id="${id}" class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart per buurt: ${titel}">${ondergrond}${sluier(bs, pad, W, hoogte)}${paden}${extra(xy)}${gebiedLabels(bs, xy)}${bronvermelding(W, hoogte)}</svg>`;
}
function kleurKaart(id, kl, waarde, hover) {
  const per = Object.fromEntries(alleBuurten().map((b) => [b.naam, b]));
  document.querySelectorAll(`#${id} path[data-buurt]`).forEach((p) => {
    const b = per[p.dataset.buurt], v = waarde(b);
    p.setAttribute("fill", kl.kleur(v));
    p.dataset.tip = hover(b, v);
  });
}
// Buurttabel met een vaste kop en een tbody die een schuifje kan herschrijven; zo blijft de
// tabel ingeklapt of uitgeklapt staan terwijl de cijfers veranderen.
const buurtTabelKop = (id, kop) =>
  `<div class="scroll"><table class="data" style="min-width:520px"><thead><tr><th>Buurt</th><th>Gebied</th><th class="getal">Woonadressen</th><th class="getal">Inwoners</th><th>${kop}</th></tr></thead><tbody id="${id}"></tbody></table></div>`;
function buurtRijen(id, waarde) {
  const rijen = alleBuurten().map((b) => ({ ...b, v: waarde(b) })).sort((a, b) => (a.v ?? 999) - (b.v ?? 999));
  document.getElementById(id).innerHTML = rijen
    .map((b) => `<tr data-koppel="${sleutel("buurt", b.naam)}"><td>${b.naam}</td><td>${GEBIED[b.gebied]}</td><td class="getal">${fmt(b.woonadressen)}</td><td class="getal">${fmt(b.inwoners)}</td><td>${balk(b.v)}</td></tr>`)
    .join("");
}
const zetWaarde = (id, tekst) => {
  const el = document.getElementById(id);
  if (el) el.textContent = tekst;
};

/* ---------- frequentie: goed bediende woonadressen ---------- */

const bediendPct = (b) => pctVan(OVN.bediendIn(b, S_OV.dagdeel, S_OV.perUur), b.woonadressen);
const bediendHover = (b, v) => `${b.naam} (${GEBIED[b.gebied]}): ${v == null ? "geen woonadressen" : `${fmt(v, 1)}% van ${fmt(b.woonadressen)} woonadressen`} heeft ${OVN.interval(S_OV.perUur)} een vertrek, ${D.ov.bediening.dagdelen[S_OV.dagdeel]}`;

function haltePunten(xy) {
  return `<g id="bed-haltes">${alleHaltes()
    .map((h, i) => {
      const [x, y] = xy([h.lon, h.lat]);
      return `<circle data-i="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" style="stroke:var(--asfalt);stroke-width:1" data-tip=""></circle>`;
    })
    .join("")}</g>`;
}

function bediening() {
  const dd = D.ov.bediening.dagdelen;
  return `<div class="normen" aria-label="Norm instellen">
      <div class="knoppen" role="group" aria-label="Dagdeel">${Object.entries(dd)
        .map(([k, l]) => `<button type="button" data-dagdeel="${k}" aria-pressed="${k === S_OV.dagdeel}">${l}</button>`)
        .join("")}</div>
      <label>Minstens <b id="bed-per-uur-w"></b> per uur per richting
        <input type="range" id="bed-per-uur" min="${D.ov.bediening.stap}" max="${D.ov.bediening.max}" step="${D.ov.bediening.stap}" value="${S_OV.perUur}" list="bed-ijk"></label>
      <datalist id="bed-ijk"><option value="2"></option><option value="4"></option><option value="6"></option></datalist>
      <button type="button" class="terug" id="bed-terug">Standaardnorm</button>
      <div class="ijk">Standaard: elk kwartier in de avond. Zes keer per uur (elke 10 minuten) geldt vaak als hoogfrequent OV. Geen van beide is een vastgestelde norm.</div>
    </div>
    <div id="bed-strip"></div>
    <h4 style="margin-top:18px">Hoe gevoelig is dat voor de grens?</h4>
    <p style="font-size:13.5px">Hetzelfde dagdeel bij drie grenzen. Liggen de uitkomsten ver uit elkaar, dan bepaalt de grens het beeld.</p>
    <div id="bed-gevoelig"></div>
    <h4 style="margin-top:22px">Per buurt</h4>
    <p style="font-size:13.5px">De punten zijn haltes: zwart als minstens één lijn er de grens haalt.</p>
    ${buurtKaart("bed-kaart", "Goed bediende woonadressen", DEKKING_KL, bediendPct, bediendHover, haltePunten)}
    ${buurtTabelKop("bed-buurten", "Goed bediend")}
    <h4 style="margin-top:22px">Vertrekken per uur op een werkdag</h4>
    <p style="font-size:13.5px">Alle vertrekken vanaf haltes in het gebied, alle lijnen en richtingen samen. De avond (vanaf 18 uur) is donker.</p>
    ${uurprofiel()}
    <div class="foot">Vertrekken per uur per richting, gemiddeld over het dagdeel. ${reikwijdte()} ${ovBron()} Uurprofiel: dienstregeling van ${ov(F.gebieden[0].code).gtfsPeildatum}, ${bronDatalade()}.</div>`;
}

function tekenBediening() {
  const dd = D.ov.bediening.dagdelen[S_OV.dagdeel];
  zetWaarde("bed-per-uur-w", `${fmt(S_OV.perUur, S_OV.perUur % 1 ? 1 : 0)} (${OVN.interval(S_OV.perUur)})`);
  document.querySelectorAll("[data-dagdeel]").forEach((k) => k.setAttribute("aria-pressed", k.dataset.dagdeel === S_OV.dagdeel));
  document.getElementById("bed-strip").innerHTML = strip(
    F.gebieden.map((g) => [`${fmt(OVN.bediend(g.code, S_OV.dagdeel, S_OV.perUur), 1)}%`, `van de woonadressen in ${g.naam} heeft ${OVN.interval(S_OV.perUur)} een vertrek, ${dd}`, ""])
  );
  const grenzen = [2, 4, 6];
  document.getElementById("bed-gevoelig").innerHTML = `<div class="scroll"><table class="data" style="min-width:480px"><thead><tr><th>${dd}</th>${grenzen
    .map((x) => `<th class="getal">${OVN.interval(x)}</th>`)
    .join("")}</tr></thead><tbody>${F.gebieden
    .map((g) => `<tr><td>${g.naam}</td>${grenzen.map((x) => `<td class="getal">${fmt(OVN.bediend(g.code, S_OV.dagdeel, x), 1)}%</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
  kleurKaart("bed-kaart", DEKKING_KL, bediendPct, bediendHover);
  const hs = alleHaltes();
  document.querySelectorAll("#bed-haltes circle").forEach((c) => {
    const h = hs[c.dataset.i], v = h[S_OV.dagdeel];
    const haalt = v >= S_OV.perUur;
    c.style.fill = haalt ? "var(--asfalt)" : "var(--wit)";
    c.dataset.tip = `${h.naam} (${h.modi.join(", ")}): beste lijn ${fmt(v, 1)} per uur per richting, ${dd}${haalt ? "" : " — haalt de norm niet"}`;
  });
  buurtRijen("bed-buurten", bediendPct);
}

NA_RENDER.push(function bedieningSchuifjes() {
  const schuif = document.getElementById("bed-per-uur");
  if (!schuif) return;
  schuif.oninput = () => {
    S_OV.perUur = Number(schuif.value);
    tekenBediening();
  };
  document.querySelectorAll("[data-dagdeel]").forEach((k) => {
    k.onclick = () => {
      S_OV.dagdeel = k.dataset.dagdeel;
      tekenBediening();
    };
  });
  document.getElementById("bed-terug").onclick = () => {
    Object.assign(S_OV, { dagdeel: F.ovKeuzes.dagdeel, perUur: F.ovKeuzes.perUur });
    schuif.value = S_OV.perUur;
    tekenBediening();
  };
  tekenBediening();
});

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

/* ---------- haltedekking ---------- */

const gedektPct = (b) => pctVan(OVN.gedektIn(b, S_OV.loopBusTramM, S_OV.loopMetroTreinM), b.woonadressen);
const gedektHover = (b, v) => `${b.naam} (${GEBIED[b.gebied]}): ${v == null ? "geen woonadressen" : `${fmt(v, 1)}% van ${fmt(b.woonadressen)} woonadressen`} binnen ${S_OV.loopBusTramM} m lopen van bus of tram of ${S_OV.loopMetroTreinM} m van metro of trein`;

function haltedekking() {
  const d = D.ov.dekking;
  return `<div class="normen" aria-label="Loopafstand instellen">
      <label>Bus en tram: <b id="dek-bus-w"></b>
        <input type="range" id="dek-bus" min="100" max="${d.busTramMaxM}" step="${d.busTramStapM}" value="${S_OV.loopBusTramM}" list="dek-bus-ijk"></label>
      <datalist id="dek-bus-ijk"><option value="300"></option><option value="400"></option><option value="500"></option><option value="600"></option></datalist>
      <label>Metro en trein: <b id="dek-metro-w"></b>
        <input type="range" id="dek-metro" min="200" max="${d.metroTreinMaxM}" step="${d.metroTreinStapM}" value="${S_OV.loopMetroTreinM}" list="dek-metro-ijk"></label>
      <datalist id="dek-metro-ijk"><option value="800"></option><option value="1000"></option><option value="1200"></option></datalist>
      <button type="button" class="terug" id="dek-terug">Standaardnorm</button>
      <div class="ijk">Loopafstand over de looproutes. Ter vergelijking: de gangbare 400 m hemelsbreed is ongeveer 500 m lopen; ouderen geven de voorkeur aan 200 tot 300 m; voor snel en frequent OV vindt de MRDH 600 tot 800 m aanvaardbaar. <a href="https://github.com/WKSu/prototype-opgaven/blob/main/docs/loopafstanden.md">Onderbouwing</a>.</div>
    </div>
    <div id="dek-strip"></div>
    <h4 style="margin-top:18px">Per buurt</h4>
    ${buurtKaart("dek-kaart", "Woonadressen binnen loopafstand", DEKKING_KL, gedektPct, gedektHover)}
    ${buurtTabelKop("dek-buurten", "Binnen loopafstand")}
    <div class="foot">Naar de dichtstbijzijnde halte, ongeacht hoe vaak er iets rijdt. Woonadressen zijn adressen in panden met een woonfunctie. Buurten met weinig adressen geven grote sprongen. ${ovBron()}</div>`;
}

function tekenDekking() {
  zetWaarde("dek-bus-w", `${S_OV.loopBusTramM} m`);
  zetWaarde("dek-metro-w", `${S_OV.loopMetroTreinM} m`);
  document.getElementById("dek-strip").innerHTML = strip(
    F.gebieden.map((g) => [`${fmt(OVN.gedekt(g.code, S_OV.loopBusTramM, S_OV.loopMetroTreinM), 1)}%`, `van de woonadressen in ${g.naam} binnen loopafstand van een halte`, ""])
  );
  kleurKaart("dek-kaart", DEKKING_KL, gedektPct, gedektHover);
  buurtRijen("dek-buurten", gedektPct);
}

NA_RENDER.push(function dekkingSchuifjes() {
  const bus = document.getElementById("dek-bus"), metro = document.getElementById("dek-metro");
  if (!bus) return;
  bus.oninput = () => {
    S_OV.loopBusTramM = Number(bus.value);
    tekenDekking();
  };
  metro.oninput = () => {
    S_OV.loopMetroTreinM = Number(metro.value);
    tekenDekking();
  };
  document.getElementById("dek-terug").onclick = () => {
    Object.assign(S_OV, { loopBusTramM: F.ovKeuzes.loopBusTramM, loopMetroTreinM: F.ovKeuzes.loopMetroTreinM });
    bus.value = S_OV.loopBusTramM;
    metro.value = S_OV.loopMetroTreinM;
    tekenDekking();
  };
  tekenDekking();
});

/* ---------- meerzijdige bereikbaarheid ---------- */

const mz = (code) => ov(code).meerzijdig;
const MZ = () => D.ov.meerzijdig.drempels;
const reikwijdte = () =>
  `Loopafstand: ${MZ().loopHalteM} m naar bus en tram, ${MZ().loopMetroTreinM} m naar metro en trein, over de looproutes. Een lijn telt mee als hij overdag minstens elk half uur rijdt.`;
const balk = (v) => (v == null ? "–" : `<span class="staaf" style="width:${(v * 1.2).toFixed(0)}px"></span>${fmt(v, 1)}%`);

// Verdeling van woonadressen over 0 tot 4 (soorten, windrichtingen), per gebied in kolommen.
function verdelingTabel(kop, labels, waarden) {
  return `<div class="scroll"><table class="data" style="min-width:480px"><thead><tr><th>${kop}</th>${F.gebieden.map((g) => `<th class="getal">${g.naam}</th>`).join("")}</tr></thead><tbody>
    ${labels.map((l, k) => `<tr><td>${l}</td>${F.gebieden.map((g) => `<td class="getal">${fmt(waarden(g.code)[k], 1)}%</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

// Per buurt, de slechtste eerst: daar zit de opgave, niet in het gebiedsgemiddelde.
function buurtTabel(veld, kop, hoogIsSlecht) {
  const rijen = F.gebieden
    .flatMap((g) => mz(g.code).perBuurt.map((b) => ({ ...b, gebied: g.naam })))
    .sort((a, b) => (hoogIsSlecht ? b[veld] - a[veld] : a[veld] - b[veld]));
  return `<h4 style="margin-top:18px">Per buurt, ${hoogIsSlecht ? "hoogste" : "laagste"} eerst</h4>
    <div class="scroll"><table class="data" style="min-width:520px"><thead><tr><th>Buurt</th><th>Gebied</th><th class="getal">Woonadressen</th><th>${kop}</th></tr></thead><tbody>
    ${rijen.map((b) => `<tr data-koppel="${sleutel("buurt", b.naam)}"><td>${b.naam}</td><td>${b.gebied}</td><td class="getal">${fmt(b.woonadressen)}</td><td>${balk(b[veld])}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// Waarde per buurt uit de meerzijdig-uitkomst, op naam (buurtnamen zijn uniek in het rayon).
const mzBuurt = (b) => mz(b.gebied).perBuurt.find((x) => x.naam === b.naam);

const SOORTEN = ["geen bruikbare lijn", "één soort", "twee soorten", "drie soorten", "vier soorten"];
function vervoersmix() {
  return `${strip(F.gebieden.map((g) => [`${fmt(mz(g.code).vervoersmix.aandeel, 1)}%`, `van de woonadressen in ${g.naam} heeft twee of meer OV-soorten op loopafstand`, ""]))}
    <h4 style="margin-top:18px">Hoeveel soorten OV op loopafstand?</h4>
    ${verdelingTabel("Soorten OV", SOORTEN, (c) => mz(c).vervoersmix.verdeling)}
    ${buurtKaart("mix-kaart", "Twee of meer OV-soorten op loopafstand", AANDEEL_KL, (b) => mzBuurt(b)?.mix ?? null, (b, v) => `${b.naam} (${GEBIED[b.gebied]}): ${v == null ? "geen woonadressen" : fmt(v, 1) + "%"}`)}
    ${buurtTabel("mix", "Twee of meer soorten", false)}
    <div class="foot">${reikwijdte()} Buurten met weinig adressen geven grote sprongen. ${ovBron()}</div>`;
}

const RICHTINGEN = ["geen bruikbare lijn", "één windrichting", "twee windrichtingen", "drie windrichtingen", "alle vier"];
function richtingCheck() {
  const lijsten = F.gebieden
    .map((g) => {
      const ls = mz(g.code).richting.lijnen.filter((l) => l.bereik >= 1);
      const tang = ls.filter((l) => l.tangentieel);
      return `<details><summary>${g.naam}: ${tang.length} van ${ls.length} lijnen tangentieel</summary><div class="scroll"><table class="data" style="min-width:560px">
        <thead><tr><th>Lijn</th><th>Soort</th><th>Traject</th><th>Rijdt door het centrum</th><th>Bereikt</th></tr></thead><tbody>
        ${[...tang, ...ls.filter((l) => !l.tangentieel)].map((l) => `<tr><td>${l.lijn}</td><td>${l.modus}</td><td>${l.traject && l.traject !== "lijn" ? l.traject : "–"}</td><td>${l.zonderGeometrie ? "onbekend" : l.tangentieel ? "nee" : "ja"}</td><td>${balk(l.bereik)}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    })
    .join("");
  const zonder = D.ov.meerzijdig.zonderGeometrie;
  return `${strip(F.gebieden.map((g) => [`${fmt(mz(g.code).richting.tangentieel, 1)}%`, `van de woonadressen in ${g.naam} heeft een lijn op loopafstand die niet door het centrum rijdt`, ""]))}
    <h4 style="margin-top:18px">Welke lijnen rijden om het centrum heen?</h4>
    <p style="font-size:13.5px">Per gebied de lijnen die minstens 1% van de woningen op loopafstand hebben. ‘Bereikt’: het aandeel woningen met die lijn op loopafstand.</p>
    ${lijsten}
    <h4 style="margin-top:22px">In hoeveel windrichtingen vertrek je vanaf je voordeur?</h4>
    <p style="font-size:13.5px">Naar welke windrichtingen (noord, oost, zuid, west) de lijnen bij je in de buurt vertrekken. Lees dit samen met de tabel hierboven: veel windrichtingen maar weinig lijnen om het centrum heen betekent dat de lijnen alle kanten op vertrekken, maar toch via het centrum rijden.</p>
    ${verdelingTabel("Windrichtingen", RICHTINGEN, (c) => mz(c).richting.windrichtingen)}
    ${buurtKaart("tang-kaart", "Tangentiële lijn op loopafstand", AANDEEL_KL, (b) => mzBuurt(b)?.tangentieel ?? null, (b, v) => `${b.naam} (${GEBIED[b.gebied]}): ${v == null ? "geen woonadressen" : fmt(v, 1) + "%"}`)}
    ${buurtTabel("tangentieel", "Tangentiële lijn op loopafstand", false)}
    <div class="foot">Om het centrum heen (tangentieel): de lijn komt niet in gebied Rotterdam Centrum. Windrichting: waar de lijn ${fmt(MZ().richtingNaM / 1000)} km verder is.${zonder.length ? ` Zonder route bekend: ${zonder.join(", ")}.` : ""} ${reikwijdte()} ${ovBron()}</div>`;
}

function storingstest() {
  const rijen = F.gebieden
    .flatMap((g) => mz(g.code).storing.corridors.slice(0, 3).map((c, i) => `<tr><td>${i ? "" : g.naam}</td><td>${c.corridor}</td><td>${balk(c.verlies)}</td></tr>`))
    .join("");
  return `${strip(F.gebieden.map((g) => {
      const c = mz(g.code).storing.corridors[0];
      return [`${fmt(c.verlies, 1)}%`, `van de woonadressen in ${g.naam} verliest bruikbaar OV als ${c.corridor} uitvalt`, ""];
    }))}
    <h4 style="margin-top:18px">De drie zwaarste storingen per gebied</h4>
    <p style="font-size:13.5px">Per verbinding: het aandeel woningen dat geen bruikbare lijn op loopafstand overhoudt als die uitvalt. Woningen die nu al geen bruikbare lijn hebben, tellen niet mee: ${F.gebieden.map((g) => `${g.naam} ${fmt(mz(g.code).zonderBruikbaar, 1)}%`).join(", ")}.</p>
    <div class="scroll"><table class="data" style="min-width:480px"><thead><tr><th>Gebied</th><th>Verbinding valt uit</th><th>Woningen zonder OV</th></tr></thead><tbody>${rijen}</tbody></table></div>
    ${buurtKaart("verlies-kaart", "Verliest bruikbaar OV bij de zwaarste storing van het gebied", VERLIES_KL, (b) => mzBuurt(b)?.verlies ?? null, (b, v) => `${b.naam} (${GEBIED[b.gebied]}): ${v == null ? "geen woonadressen" : fmt(v, 1) + "%"}`)}
    ${buurtTabel("verlies", "Verliest OV bij de zwaarste storing van het gebied", true)}
    <div class="foot">Een verbinding is een lijn samen met de lijnen die de helft van zijn haltes delen; zo vallen metro A, B en C samen uit. ${reikwijdte()} ${ovBron()}</div>`;
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
    <div class="foot">${RC.bron}, ${RC.periode}. ${RC.regel[0].toUpperCase() + RC.regel.slice(1)}. Rayon, gewogen naar respondenten: ${fmt(RC.rayon.cijfer, 1)}, ${RC.rayon.onvoldoende}% onvoldoende, n = ${fmt(RC.rayon.n)}.</div>`;
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
      return `<path d="${pad(geo[d.code])}" data-koppel="${sleutel("subbuurt", s.code)} ${sleutel("deel", d.code)}" fill="${s.aandeel == null ? "var(--beton-diep)" : rbKleur(s.aandeel)}"><title>${titel}</title></path>`;
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
      .map((s) => `<tr data-koppel="${sleutel("subbuurt", s.code)}"><td>${s.code}</td><td>${s.buurt}</td><td>${GEBIED[s.gebied]}</td><td class="getal">${fmt(s.plekken)}</td><td class="getal">${ha(s.parkeren)} ha</td><td class="getal">${ha(s.openbaar)} ha</td>
        <td><span class="staaf" style="width:${Math.min(4 * s.aandeel, 140).toFixed(0)}px"></span>${fmt(s.aandeel, 1)}%</td><td>${{ telling: "telling", bgt: "BGT", mix: "telling + BGT" }[s.bron]}</td></tr>`)
      .join("")}</tbody></table></div>`;
  return `${strip(F.gebieden.map((g) => {
      const p = per[g.code];
      return p.aandeel == null ? ["–", `geen cijfer voor ${g.naam}`, ""] : [`${fmt(p.aandeel)}%`, `van de openbare ruimte in ${g.naam} is parkeervlak`, `${p.met.length} van ${p.sb.length} subbuurten · ${fmt(p.plekken)} plekken`];
    }))}
    <h4 style="margin-top:18px">Ruimtebeslag per subbuurt</h4>
    <p style="font-size:13.5px">Waar geteld is, komt het aantal plekken uit de telling (${fmt(RB.m2PerPlek, 1)} m² per plek). Elders telt het oppervlak van de parkeervlakken op de kaart (BGT, gestippeld). De ${fmt(RB.m2PerPlek, 1)} m² is zo gekozen dat beide op dezelfde schaal staan: zoveel parkeervlak ligt er gemiddeld per getelde plek.</p>
    ${ruimtebeslagKaart()}
    <h4 style="margin-top:22px">Hoeveel maakt ‘groot park’ uit?</h4>
    <p style="font-size:13.5px">Grote parken tellen niet mee als openbare ruimte. Nu geldt aaneengesloten groen vanaf ${fmt(RB.grootPark.ha)} ha als groot park. Zo verandert de uitkomst bij een andere grens:</p>
    <div class="scroll"><table class="data" style="min-width:520px"><thead><tr><th>Groot park vanaf</th>${F.gebieden.map((g) => `<th class="getal">${g.naam}</th>`).join("")}</tr></thead><tbody>
      ${grenzen
        .map((gr) => `<tr${gr === RB.grootPark.ha ? ' style="font-weight:700"' : ""}><td>${gr == null ? "geen park uitgesloten" : `${fmt(gr, gr < 1 ? 1 : 0)} ha`}</td>${F.gebieden.map((g) => `<td class="getal">${fmt(rbGebied(g.code, gr).aandeel, 1)}%</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>
    <h4 style="margin-top:22px">De 10 subbuurten met het hoogste ruimtebeslag</h4>
    ${tabel(alle.slice(0, 10))}
    <details><summary>Alle ${alle.length} subbuurten met een cijfer</summary>${tabel(alle)}</details>
    <div class="foot">Rekenregel: ${RB.regel}. Teller: ${RB.teller}. Noemer: ${RB.noemer}. Alleen subbuurten met woonadressen tellen mee in de gebiedscijfers. Bron: ${RB.bron}; BGT © Kadaster, CC-BY 4.0.</div>`;
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
    const kop = `${buurtVan(k.code) ? buurtVan(k.code) + ", s" : "S"}ubbuurt ${k.code} (${GEBIED[k.gebied]})`;
    if (!s) return `${kop}: niet geteld`;
    const t = FP.tellingen[s.telling];
    if (s.druk == null) return `${kop}: geen voorzieningen, ${fmt(s.fietsen)} fietsen op straat. ${t.naam} ${t.jaar}, ${MOMENT_FIETS[t.maatgevend]}`;
    return `${kop}: ${fmt(s.druk)}% · ${fmt(s.fietsen)} fietsen op ${fmt(s.capaciteit)} plekken, ${fmt(s.wild)} buiten een voorziening. ${t.naam} ${t.jaar}, ${MOMENT_FIETS[t.maatgevend]}`;
  };
  const koppelSb = (k) => [sleutel("subbuurt", k.code), per[k.code] ? sleutel("fietstelling", per[k.code].telling) : ""].join(" ").trim();
  const paden = kaart.map((k) => `<path d="${pad(k.geometrie)}" data-koppel="${koppelSb(k)}" fill="${vulling(per[k.code])}"><title>${titel(k, per[k.code])}</title></path>`).join("");
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
    .map((t, ti) => {
      const cap = t.metingen[0].capaciteit;
      const ms = t.metingen
        .map((m) => {
          const vet = m.moment === t.maatgevend;
          return `<div style="display:grid;grid-template-columns:5.5em 118px 4.2em;gap:8px;align-items:center;${vet ? "font-weight:700" : ""}">
            <span>${MOMENT_FIETS[m.moment]}</span><span><span class="staaf" style="width:${((110 * m.druk) / max).toFixed(0)}px;${vet ? "" : "opacity:.45"}"></span></span><span style="text-align:right">${fmt(m.druk)}%</span></div>`;
        })
        .join("");
      return `<tr data-koppel="${sleutel("fietstelling", ti)}"><td>${t.naam}<div class="toel">Ecorys ${t.jaar}, ${t.code}</div></td><td>${GEBIED[t.gebied]}</td><td class="getal">${fmt(t.subbuurten)}</td><td class="getal">${fmt(cap)}</td><td>${ms}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="data" style="min-width:640px"><thead><tr><th>Telling</th><th>Gebied</th><th class="getal">Subbuurten</th><th class="getal">Capaciteit</th><th>Druk per meetmoment</th></tr></thead><tbody>${rijen}</tbody></table></div>`;
}

function fietsSubbuurten(rijen) {
  const buurt = Object.fromEntries((P ? P.subbuurtdelen : []).map((d) => [d.subbuurt, d.buurt]));
  return `<div class="scroll"><table class="data" style="min-width:640px"><thead><tr><th>Subbuurt</th><th>Telling</th><th class="getal">Capaciteit</th><th class="getal">Fietsen</th><th class="getal">Waarvan buiten voorziening</th><th>Druk</th><th class="getal">Tekort</th></tr></thead><tbody>
    ${rijen
      .map((s) => `<tr data-koppel="${sleutel("subbuurt", s.code)}"><td>${s.code}<div class="toel">${buurt[s.code] || GEBIED[s.gebied]}</div></td><td>${FP.tellingen[s.telling].naam}</td><td class="getal">${fmt(s.capaciteit)}</td><td class="getal">${fmt(s.fietsen)}</td><td class="getal">${fmt(s.wild)}</td>
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
    <div class="foot">${FP.bron}. Rekenregel: ${FP.regel}. Maatgevend: ${FP.maatgevend}. Alleen subbuurten met woonadressen tellen mee in de gebiedscijfers.</div>`;
}

/* ---------- woningbouw en P+R (context, geen indicator) ---------- */

// Meters tussen twee punten in WGS84; op deze schaal volstaat een vlakke benadering.
const meters = (a, b) => {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k * 111320, (a[1] - b[1]) * 110540);
};
const naaste = (p, lijst) => lijst.reduce((best, x) => { const m = meters(p, x.pt); return !best || m < best.m ? { ...x, m } : best; }, null);
// Hoe zekerder het project, hoe donkerder de stip.
const WB_TINT = { GESTART: 90, HARDE_PLANVOORRAAD: 60, ZACHTE_PLANVOORRAAD: 32, STUDIE: 12 };

function woningbouwProjecten() {
  const kaart = Object.fromEntries(D.parkeren.subbuurten.kaart.map((k) => [k.code, k]));
  const druk = Object.fromEntries((P ? P.subbuurten : []).map((s) => [s.code, s]));
  const knopen = D.gebieden.flatMap((g) => D.ov.perGebied[g].haltes.filter((h) => h.modi.some((m) => m === "metro" || m === "trein")).map((h) => ({ naam: h.naam, pt: [h.lon, h.lat] })));
  const prs = (PRR ? PRR.terreinen : []).map((t) => ({ ...t, pt: [t.lon, t.lat] }));
  return WB.projecten
    .filter((p) => p.status !== "OPGELEVERD")
    .map((p) => {
      const pt = [p.lon, p.lat];
      const s = druk[p.subbuurt], k = kaart[p.subbuurt];
      return {
        ...p,
        druk: s ? s.druk : null,
        autobezit: k ? k.autosPerWoonadres : null,
        // Ruwe orde van grootte: zoveel auto's als de buurt nu per woonadres heeft. Geen norm.
        autos: k && k.autosPerWoonadres != null ? p.woningen * k.autosPerWoonadres : null,
        knoop: knopen.length ? naaste(pt, knopen) : null,
        pr: prs.length ? naaste(pt, prs) : null,
      };
    });
}

function woningbouwKaart(projecten) {
  const kaart = D.parkeren.subbuurten.kaart;
  const W = 800;
  const { xy, hoogte, ondergrond } = projectie(kaart, W);
  const pad = padVan(xy);
  const druk = Object.fromEntries((P ? P.subbuurten : []).map((s) => [s.code, s.druk]));
  const vlakken = kaart.map((k) => `<path d="${pad(k.geometrie)}" fill="${druk[k.code] != null ? drukKleur(druk[k.code]) : "var(--beton-diep)"}" style="pointer-events:none"/>`).join("");
  const stippen = [...projecten]
    .sort((a, b) => b.woningen - a.woningen)
    .map((p) => {
      const [x, y] = xy([p.lon, p.lat]);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(2.5, Math.sqrt(p.woningen) * 0.7).toFixed(1)}" style="fill:color-mix(in srgb, var(--asfalt) ${WB_TINT[p.status]}%, var(--wit));stroke:var(--asfalt);stroke-width:.8"><title>${p.naam}: ${fmt(p.woningen)} woningen, ${WB.statussen[p.status]}, oplevering ${p.jaar ?? "onbekend"}</title></circle>`;
    })
    .join("");
  const pr = (PRR ? PRR.terreinen : [])
    .map((t) => {
      const [x, y] = xy([t.lon, t.lat]);
      return `<g><rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" rx="2" style="fill:var(--schie);stroke:var(--wit);stroke-width:1.2"><title>${t.naam}: ${fmt(t.capaciteit)} plekken (NPR)</title></rect><text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" style="font-size:10.5px;font-weight:700">${fmt(t.capaciteit)}</text></g>`;
    })
    .join("");
  const legenda =
    Object.entries(WB_TINT).map(([s, t]) => `<span><i style="border-radius:50%;width:10px;background:color-mix(in srgb, var(--asfalt) ${t}%, var(--wit));border-color:var(--asfalt)"></i>${WB.statussen[s]}</span>`).join("") +
    `<span><i style="background:var(--schie);border-radius:2px;width:10px"></i>P+R, met capaciteit</span><span>vlakken: parkeerdruk werkdagnacht, zelfde klassen als hierboven</span>`;
  return `<div class="legenda-rij"><b>Woningbouw (stip naar aantal woningen) en P+R</b>${legenda}</div>
    <svg class="kaart-svg" viewBox="0 0 ${W} ${hoogte.toFixed(0)}" role="img" aria-label="Kaart van geplande woningbouw, parkeerdruk per subbuurt en P+R-terreinen">${ondergrond}${sluier(kaart, pad, W, hoogte)}${vlakken}${stippen}${pr}${gebiedLabels(kaart, xy)}${bronvermelding(W, hoogte)}</svg>`;
}

function woningbouwTabel(rijen) {
  return `<div class="scroll"><table class="data" style="min-width:820px"><thead><tr><th>Project</th><th>Fase</th><th class="getal">Woningen</th><th class="getal">Sociaal</th><th class="getal">Parkeerdruk subbuurt</th><th class="getal">Auto’s per woonadres</th><th class="getal">Auto’s bij huidig autobezit</th><th>Metro of trein</th><th>Naaste P+R</th></tr></thead><tbody>
    ${rijen
      .map((p) => `<tr><td>${p.naam}<div class="toel">${p.buurt}, ${GEBIED[p.gebied]}</div></td><td>${WB.statussen[p.status]}<div class="toel">oplevering ${p.jaar ?? "onbekend"}</div></td>
        <td class="getal">${fmt(p.woningen)}</td><td class="getal">${p.woningen ? fmt((100 * p.sociaal) / p.woningen) + "%" : "–"}</td>
        <td class="getal">${p.druk == null ? '<span class="toel">niet geteld</span>' : fmt(p.druk, 1) + "%"}</td><td class="getal">${fmt(p.autobezit, 2)}</td><td class="getal">${p.autos == null ? "–" : "~" + fmt(Math.round(p.autos / 10) * 10)}</td>
        <td>${p.knoop ? `${p.knoop.naam}<div class="toel">${fmt(Math.round(p.knoop.m / 50) * 50)} m</div>` : "–"}</td><td>${p.pr ? `${p.pr.naam.replace(/^P\+R /, "")}<div class="toel">${fmt(Math.round(p.pr.m / 100) * 100)} m · ${fmt(p.pr.capaciteit)} plekken</div>` : "–"}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function prTabel() {
  const t = PRR.terreinen;
  return `<div class="scroll"><table class="data" style="min-width:600px"><thead><tr><th>P+R</th><th class="getal">Plekken</th><th class="getal">Laadpunten</th><th>Ligging</th><th>NPR-gegevens</th></tr></thead><tbody>
    ${t
      .map((r) => `<tr><td>${r.naam}<div class="toel">${r.plaats}</div></td><td class="getal">${fmt(r.capaciteit)}</td><td class="getal">${fmt(r.laadpunten)}</td>
        <td>${r.inRayon ? "in het rayon" : `${fmt(Math.round(r.afstandM / 50) * 50)} m buiten het rayon`}</td>
        <td>capaciteit sinds ${r.specificatieVanaf}${r.verlopen ? ' <span class="toel">· registratie verlopen</span>' : ""}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function woningbouwEnPR() {
  const ps = woningbouwProjecten();
  const knoopM = D.ov.meerzijdig.drempels.loopMetroTreinM;
  const per = F.gebieden.map((g) => {
    const x = ps.filter((p) => p.gebied === g.code);
    const som = (f) => x.filter(f).reduce((a, p) => a + p.woningen, 0);
    return { g, totaal: som(() => true), druk: som((p) => p.druk > 85), knoop: som((p) => p.knoop && p.knoop.m <= knoopM), zeker: som((p) => p.status === "GESTART" || p.status === "HARDE_PLANVOORRAAD") };
  });
  const groot = [...ps].sort((a, b) => b.woningen - a.woningen);
  const prIn = PRR ? PRR.terreinen.filter((t) => t.inRayon) : [];
  return `<section id="woningbouw" data-onderwerp="parkeren-woningbouw" data-label="Woningbouw en P+R">
    <div class="eyebrow">Context · geen indicator</div>
    <h2>Wat er op parkeren afkomt: woningbouw en P+R</h2>
    <p class="def">Geen indicator, wel de vraagkant die eraan komt. Elke nieuwe woning vraagt parkeerruimte: op eigen terrein volgens de parkeernorm, of op straat. Waar de straat ’s nachts al boven 85% zit (het streven uit de nota), kan nieuwbouw niet op de straat leunen. Waar metro of trein op loopafstand ligt, is een lagere parkeernorm te verdedigen. En na de invoering van betaald parkeren is de P+R het opvangvermogen voor wie niet meer in de wijk parkeert.</p>
    <div class="box"><h4>Woningbouw in de pijplijn (BoPro)</h4>
      ${strip(per.map((x) => [fmt(x.totaal), `woningen gepland in ${x.g.naam}`, `${fmt(x.zeker)} in aanbouw of harde plancapaciteit · ${fmt(x.druk)} in subbuurten boven 85% · ${fmt(x.knoop)} binnen ${fmt(knoopM)} m van metro of trein`]))}
      <h4 style="margin-top:18px">Waar komen de woningen, en hoe vol is de straat daar?</h4>
      <p style="font-size:13.5px">Stip = project, oppervlak naar het aantal woningen, donkerder naarmate het zekerder is. Vlak = parkeerdruk op de werkdagnacht. Vierkant = P+R met capaciteit. Opgeleverde projecten staan er niet op.</p>
      ${woningbouwKaart(ps)}
      <h4 style="margin-top:22px">De 15 grootste projecten, naast parkeren</h4>
      <p style="font-size:13.5px">‘Auto’s bij huidig autobezit’ is een orde van grootte: het aantal woningen maal het autobezit per woonadres in de subbuurt nu. Het is geen parkeernorm en geen prognose; het laat zien wat er op de straat afkomt als de nieuwe bewoners zich gedragen als de buurt.</p>
      ${woningbouwTabel(groot.slice(0, 15))}
      <details><summary>Alle ${ps.length} projecten in de pijplijn</summary>${woningbouwTabel(groot)}</details>
      <div class="foot">${WB.bron}. Een project hoort bij de subbuurt waarin zijn middelpunt ligt. Fasen: ${Object.values(WB.statussen).slice(1).join(", ")}; zachte plancapaciteit en studie kunnen nog veranderen of vervallen. Metro en trein: haltes uit de datalade (GTFS). Bouwen met <code>scripts/bouw_woningbouw.py</code>.</div>
    </div>
    ${PRR ? `<div class="box"><h4>P+R in en rond het rayon (NPR)</h4>
      <p style="font-size:13.5px">${prIn.length} P+R-terreinen in het rayon met samen ${fmt(prIn.reduce((a, t) => a + t.capaciteit, 0))} plekken, en ${PRR.terreinen.length - prIn.length} net erbuiten (tot ${fmt(PRR.straalM)} m). Na de invoering van betaald parkeren kan wie bij de metrohalte in de wijk parkeerde, hierheen uitwijken: dit is de capaciteit om dat op te vangen. Hoe vol de terreinen zijn, staat niet in het register.</p>
      ${prTabel()}
      <div class="foot">${PRR.bron}, opgehaald ${PRR.opgehaald}. Capaciteit uit de recentste specificatie per terrein; de datum laat zien hoe oud die is. ‘Registratie verlopen’: de geldigheid van het NPR-record is voorbij, het terrein kan er nog liggen. Ophalen met <code>scripts/haal_npr.py</code>.</div>
    </div>` : ""}
    <div class="nodig"><b>Nodig om dit scherper te maken</b>Bezetting per P+R (overdag, werkdag), de geplande parkeeroplossing per woningbouwproject (eigen terrein, garage, straat), en de parkeernorm die per project is toegepast.</div>
  </section>`;
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
  "ov-frequentie": bediening,
  "ov-haltedekking": haltedekking,
  "ov-vervoersmix": vervoersmix,
  "ov-richting": richtingCheck,
  "ov-storing": storingstest,
};

/* ---------- kaart en tabel koppelen ---------- */

// Kaartvlakken en tabelrijen dragen data-koppel: een of meer sleutels "soort:waarde", gescheiden
// door spaties. De eerste sleutel van een vlak is zijn eigen naam (bijvoorbeeld de subbuurt);
// de rest zijn groepen waar het bij hoort (telling, sector). Een rij licht elk vlak op met die
// sleutel; een vlak licht de rijen met zijn eerste sleutel op. Klikken zet de keuze vast.
const sleutel = (soort, waarde) => `${soort}:${String(waarde).replace(/\s+/g, "_")}`;
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const sleutels = (el) => (el.dataset.koppel || "").split(" ").filter(Boolean);
let vastgezet = [];

function markeer(keys) {
  document.querySelectorAll("tr[data-koppel]").forEach((r) => r.classList.toggle("uitgelicht", sleutels(r).some((k) => keys.includes(k))));
  // Omlijning als bovenste laag: het vlak zelf verschuift niet, en arceringen blijven zichtbaar.
  document.querySelectorAll("svg.kaart-svg").forEach((svg) => {
    svg.querySelectorAll(".omlijning").forEach((o) => o.remove());
    svg.querySelectorAll("[data-koppel]").forEach((v) => {
      if (!sleutels(v).some((k) => keys.includes(k))) return;
      const o = document.createElementNS("http://www.w3.org/2000/svg", v.tagName);
      for (const a of ["d", "cx", "cy", "r"]) if (v.hasAttribute(a)) o.setAttribute(a, v.getAttribute(a));
      o.setAttribute("class", "omlijning");
      const knip = v.closest("[clip-path]");
      (knip && knip !== svg ? knip : svg).appendChild(o);
    });
  });
}

let label;
function toonLabel(el, x, y) {
  if (!label) {
    label = document.createElement("div");
    label.className = "kaartlabel";
    document.body.appendChild(label);
  }
  // De naam staat voor de eerste dubbele punt; die wordt vet.
  const tip = el.dataset.tip, i = tip.indexOf(":");
  label.innerHTML = i > 0 ? `<b>${attr(tip.slice(0, i))}</b>${attr(tip.slice(i + 1).trim())}` : `<b>${attr(tip)}</b>`;
  label.hidden = false;
  const b = label.getBoundingClientRect();
  label.style.left = `${Math.min(x + 14, innerWidth - b.width - 8)}px`;
  label.style.top = `${y + 18 + b.height > innerHeight ? y - b.height - 10 : y + 18}px`;
}
const verbergLabel = () => label && (label.hidden = true);

function koppel() {
  // Eén label: de eigen titel van de browser verdwijnt, anders verschijnen er twee.
  document.querySelectorAll("svg.kaart-svg [data-koppel] > title, svg.kaart-svg circle > title").forEach((tt) => {
    tt.parentElement.dataset.tip = tt.textContent;
    tt.remove();
  });
  document.addEventListener("pointerover", (e) => {
    const r = e.target.closest("tr[data-koppel]");
    const v = e.target.closest("svg.kaart-svg [data-koppel]");
    if (r) markeer(sleutels(r));
    else if (v) markeer(sleutels(v).slice(0, 1));
  });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest("tr[data-koppel], svg.kaart-svg [data-koppel]")) markeer(vastgezet);
    if (e.target.closest("svg.kaart-svg [data-tip]")) verbergLabel();
  });
  document.addEventListener("pointermove", (e) => {
    const v = e.target.closest("svg.kaart-svg [data-tip]");
    if (v) toonLabel(v, e.clientX, e.clientY);
  });
  document.addEventListener("click", (e) => {
    const r = e.target.closest("tr[data-koppel]");
    const v = e.target.closest("svg.kaart-svg [data-koppel]");
    if (!r && !v) return;
    const keys = r ? sleutels(r) : sleutels(v).slice(0, 1);
    vastgezet = vastgezet.join() === keys.join() ? [] : keys;
    markeer(vastgezet);
    // Op een telefoon is er geen hover: toon het label bij de tik.
    if (v && v.dataset.tip) toonLabel(v, e.clientX, e.clientY);
    // Vanuit een rij: haal de kaart van hetzelfde blok in beeld als hij buiten beeld is.
    if (r && vastgezet.length) {
      const kaart = [...(r.closest("section") || document).querySelectorAll("svg.kaart-svg")].find((s) => s.querySelector(".omlijning"));
      if (kaart) kaart.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

/* ---------- pagina ---------- */

// Boven de MAX_RIJEN rijen komt een tabel in een <details>, zodat de pagina leesbaar blijft.
// Een tabel met data-open blijft altijd zichtbaar.
const MAX_RIJEN = 8;
function klapIn(root) {
  root.querySelectorAll("table.data").forEach((tabel) => {
    if (tabel.closest("details") || tabel.hasAttribute("data-open")) return;
    const n = tabel.tBodies[0] ? tabel.tBodies[0].rows.length : 0;
    if (n <= MAX_RIJEN) return;
    const blok = tabel.parentElement.classList.contains("scroll") ? tabel.parentElement : tabel;
    const d = document.createElement("details");
    d.className = "tabel-in";
    d.innerHTML = `<summary>Tabel tonen (${n} rijen)</summary>`;
    blok.replaceWith(d);
    d.appendChild(blok);
  });
}

// Per indicator: wat hij zegt, hoe hij gemeten is, waar je op let, en wat je nog niet ziet.
// Daarna de kaarten en tabellen.
function blok(ind) {
  const dl = ind.datalade;
  const vis = VISUEEL[ind.sleutel];
  const uitleg = [
    ["Hoe gemeten", ind.meting],
    ["Let op", ind.letop],
    ["Nog niet te zien", dl.ontbreekt],
  ].filter(([, tekst]) => tekst);
  return `<section id="i-${ind.sleutel}" data-onderwerp="onderzoek-${ind.sleutel}" data-label="${ind.naam}">
    ${ind.groep ? `<div class="eyebrow">${ind.groep}</div>` : ""}
    <h2>${ind.naam} ${statusChip(dl.status)}</h2>
    <p class="kernvraag">${ind.vraag}</p>
    <dl class="uitleg">${uitleg.map(([kop, tekst]) => `<div${kop === "Nog niet te zien" ? ' class="mist"' : ""}><dt>${kop}</dt><dd>${tekst}</dd></div>`).join("")}</dl>
    ${vis ? `<div class="box">${veilig(ind.sleutel, vis)}</div>` : ""}
  </section>`;
}

const INTRO = {
  parkeren: "Hoe vol staan straten en stallingen, hoe tevreden zijn bewoners, en hoeveel ruimte kost parkeren? Per indicator lees je wat hij zegt, hoe hij gemeten is en waar je op let. De cijfers staan hier zonder normen; het oordeel staat in het overzicht.",
  ov: "Hoe goed worden de woningen bediend door bus, tram, metro en trein? Het gaat om het aanbod volgens de dienstregeling, niet om gebruik of stiptheid. Per indicator lees je wat hij zegt, hoe hij gemeten is en waar je op let. Normen voor frequentie en loopafstand zijn in te stellen.",
};

function pagina() {
  const inds = THEMA.indicatoren;
  const open = inds.filter((i) => i.datalade.ontbreekt);
  document.getElementById("inhoud").innerHTML = `
    <section id="s0" data-onderwerp="${THEMA.sleutel}-overzicht" data-label="Overzicht" data-review="tekst" data-review-vraag="Wat mis je in deze viewer?" style="border-bottom:4px solid var(--asfalt)">
      <div class="eyebrow">Rayon ${F.rayon.naam}</div>
      <h1>${THEMA.naam}</h1>
      <p class="lead">${INTRO[THEMA.sleutel]}</p>
      <ol class="inhoudsopgave">${inds
        .map((i) => `<li><a href="#i-${i.sleutel}">${i.naam}</a> ${statusChip(i.datalade.status)}<span class="tocvraag">${i.vraag}</span></li>`)
        .join("")}</ol>
    </section>
    ${inds.map(blok).join("")}
    ${THEMA.sleutel === "parkeren" && WB ? veilig("woningbouw", woningbouwEnPR) : ""}
    <section id="nodig" data-onderwerp="${THEMA.sleutel}-nodig" data-label="Nog niet beschikbaar" data-review="tekst" data-review-vraag="Welke data kun je leveren, en wanneer?" style="border-bottom:0">
      <div class="eyebrow">Nog niet beschikbaar</div>
      <h2>Wat je hier nog niet ziet</h2>
      <div class="scroll"><table class="data" data-open style="min-width:520px"><thead><tr><th>Indicator</th><th>Nog niet te zien</th></tr></thead><tbody>
        ${open.map((i) => `<tr><td><a href="#i-${i.sleutel}">${i.naam}</a></td><td>${i.datalade.ontbreekt}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="foot">Bronnen: <a href="${D.bronnen.datalade.url}#gebied=${F.rayon.code}">${bronDatalade()}</a> (versie ${kort(D.bronnen.datalade.commit)}) en de <a href="${D.bronnen.loopbaarheid.url}">${bronLoop()}</a> (versie ${kort(D.bronnen.loopbaarheid.commit)}).</p>
    </section>`;
  NA_RENDER.forEach((fn) => veilig(fn.name, fn));
  klapIn(document.getElementById("inhoud"));
  veilig("koppel", koppel);
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
