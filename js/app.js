// Rendert de eerste laag uit FUNCTIONEREN (data/indicatoren.js).
// Elk blok draait in veilig(): ontbreekt iets, dan valt alleen dat blok weg, niet de pagina.

const S = { normen: true };

const SOORT = {
  beleid: "Vastgesteld beleid",
  afspraak: "Afspraak themateam",
  geen: "Geen norm",
};
const OORDEEL = {
  rood: { t: "Voldoet niet", g: "▲" },
  aandacht: { t: "Boven streefwaarde", g: "◆" },
  ok: { t: "Voldoet", g: "✓" },
  geen: { t: "Alleen tonen", g: "–" },
  leeg: { t: "Ontbreekt", g: "○" },
  deels: { t: "Deels gemeten", g: "◐" },
};

function veilig(naam, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[${naam}]`, e);
    const b = document.body;
    b.dataset.veiligFouten = [b.dataset.veiligFouten, naam].filter(Boolean).join(" ");
  }
}

const F = FUNCTIONEREN;
const alleIndicatoren = () => F.themas.flatMap((t) => t.indicatoren);
const themaVan = (ind) => F.themas.find((t) => t.indicatoren.includes(ind));

// Waar de datalade het antwoord al heeft, vervangt het echte cijfer het fictieve. Ontbreekt
// data/datalade.js, dan blijft de mock-up staan. Alle cijfers hier zijn OV, berekend uit de
// OV-verkenner; zo heet de bron bij de waarde ook.
const BRON_DATALADE = "OV-verkenner";
const UIT_DATALADE = {
  // Frequentie en haltedekking bij de standaardnorm (FUNCTIONEREN.ovKeuzes); in de OV-viewer
  // zijn ze in te stellen. De rekenregel staat in js/ov-normen.js.
  "ov-frequentie": (code) => {
    const k = OVN.keuzes();
    return { v: OVN.bediend(code, k.dagdeel, k.perUur), toel: `${DATALADE.ov.bediening.dagdelen[k.dagdeel]}, ${OVN.interval(k.perUur)}` };
  },
  "ov-haltedekking": (code) => {
    const k = OVN.keuzes();
    return { v: OVN.gedekt(code, k.loopBusTramM, k.loopMetroTreinM), toel: `${k.loopBusTramM} m bus/tram, ${k.loopMetroTreinM} m metro/trein lopen` };
  },
  "ov-vervoersmix": (code) => {
    const m = DATALADE.ov.perGebied[code].meerzijdig;
    return { v: m.vervoersmix.aandeel, toel: `${fmt(m.zonderBruikbaar)}% zonder bruikbare lijn` };
  },
  "ov-richting": (code) => {
    const r = DATALADE.ov.perGebied[code].meerzijdig.richting;
    return { v: r.tangentieel, toel: `${fmt(r.windrichtingen[3] + r.windrichtingen[4])}% in 3 of 4 windrichtingen` };
  },
  "ov-storing": (code) => {
    const c = DATALADE.ov.perGebied[code].meerzijdig.storing.corridors[0];
    return { v: c.verlies, toel: `bij uitval van ${c.corridor}` };
  },
};
// Handmatige leveringen staan los van de datalade, elk in een eigen bestand. `geladen` zegt of
// dat bestand er is; zo niet, dan blijft de mock-up staan.
const woonSubbuurten = () => (typeof DATALADE !== "undefined" ? new Set(DATALADE.parkeren.subbuurten.kaart.map((k) => k.code)) : null);
const UIT_HANDMATIG = {
  // Een gebied zonder telling is onbekend, geen 0. Telt maar een deel van de subbuurten, dan
  // kan het cijfer rood worden, maar nooit "voldoet": een ongetelde subbuurt is niet onder 90%.
  "parkeerdruk-subbuurt": {
    label: "telling",
    geladen: () => typeof PARKEERDRUK !== "undefined",
    fn: (code) => {
      const woon = woonSubbuurten();
      const sb = PARKEERDRUK.subbuurten.filter((s) => s.gebied === code && (!woon || woon.has(s.code)));
      const geteld = sb.filter((s) => s.druk != null);
      if (!geteld.length) return { v: null, toel: `geen werkdagnachttelling · ${sb.length} subbuurten` };
      const tussen = geteld.filter((s) => s.druk > 85 && s.druk <= 90).length;
      return {
        v: geteld.filter((s) => s.druk > 90).length,
        toel: `van ${geteld.length} geteld (${sb.length}) · ${tussen} tussen 85–90%`,
        onvolledig: geteld.length < sb.length || geteld.some((s) => !s.volledig),
      };
    },
  },
  "beleving-parkeren": {
    label: "enquête",
    geladen: () => typeof RAPPORTCIJFER !== "undefined",
    fn: (code) => {
      const g = RAPPORTCIJFER.gebieden[code];
      return { v: g.cijfer, toel: `${g.onvoldoende}% onvoldoende · n = ${g.n}${g.indicatief ? ", indicatief" : ""}` };
    },
  },
  // Druk over de getelde subbuurten met voorzieningen; geen telling is onbekend, geen 0.
  "bezetting-fietsparkeren": {
    label: "telling",
    geladen: () => typeof FIETSPARKEREN !== "undefined",
    fn: (code) => {
      const woon = woonSubbuurten();
      const alle = woon ? [...woon].filter((c) => DATALADE.parkeren.subbuurten.kaart.find((k) => k.code === c).gebied === code).length : null;
      const sb = FIETSPARKEREN.subbuurten.filter((s) => s.gebied === code && (!woon || woon.has(s.code)));
      if (!sb.length) return { v: null, toel: `geen fietsparkeertelling${alle ? ` · ${alle} subbuurten` : ""}` };
      const cap = sb.reduce((a, s) => a + s.capaciteit, 0), f = sb.reduce((a, s) => a + s.fietsen, 0);
      return {
        v: Math.round((100 * f) / cap),
        toel: `${fmt(cap)} plekken · ${sb.filter((s) => s.druk > 100).length} van ${sb.length} subbuurten boven 100%${alle && sb.length < alle ? ` (${alle})` : ""}`,
      };
    },
  },
  // Som over som, alleen subbuurten met woonadressen: daar gaat het straatprofiel over.
  "ruimtebeslag-parkeren": {
    label: "BGT",
    geladen: () => typeof RUIMTEBESLAG !== "undefined",
    fn: (code) => {
      const woon = woonSubbuurten();
      const sb = RUIMTEBESLAG.subbuurten.filter((s) => s.gebied === code && (!woon || woon.has(s.code)));
      const met = sb.filter((s) => s.aandeel != null);
      if (!met.length) return { v: null, toel: `geen BGT · ${sb.length} subbuurten` };
      const teller = met.reduce((a, s) => a + s.parkeren, 0), noemer = met.reduce((a, s) => a + s.openbaar, 0);
      const geteld = met.filter((s) => s.bron === "telling").length;
      return { v: Math.round((100 * teller) / noemer), toel: `${met.length} van ${sb.length} subbuurten · ${geteld} geheel uit telling` };
    },
  },
};
function waarde(ind, code) {
  const hand = UIT_HANDMATIG[ind.sleutel];
  if (hand && hand.geladen()) return { ...hand.fn(code), echt: hand.label };
  const echt = typeof DATALADE !== "undefined" && UIT_DATALADE[ind.sleutel];
  if (echt) return { ...echt(code), echt: BRON_DATALADE };
  return ind.waarden[code] || { v: null };
}
// Het overzicht toont alleen indicatoren met echte cijfers; de rest staat met wat er nodig is in
// de themaviewer. Een gebied zonder cijfer binnen zo'n indicator blijft zichtbaar als 'Ontbreekt'.
const heeftCijfers = (ind) => {
  const hand = UIT_HANDMATIG[ind.sleutel];
  return (hand && hand.geladen()) || (typeof DATALADE !== "undefined" && !!UIT_DATALADE[ind.sleutel]);
};
const getoond = (thema) => thema.indicatoren.filter(heeftCijfers);
const normVan = (ind) => (ind.norm ? F.normen[ind.norm] : null);
const fmt = (v, d = 0) =>
  v.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });

// Ontbrekende data is een feit, geen oordeel: "leeg" blijft ook zichtbaar als de normenlaag uit staat.
function oordeel(v, norm) {
  if (v == null) return "leeg";
  if (!norm) return "geen";
  const voldoetNiet = norm.richting === "onder" ? v < norm.grens : v >= norm.grens;
  if (voldoetNiet) return "rood";
  if (norm.streef != null && v > norm.streef) return "aandacht";
  return "ok";
}

function chip(st) {
  const o = OORDEEL[st];
  return `<span class="oordeel o-${st}"><span aria-hidden="true">${o.g}</span>${o.t}</span>`;
}

function cel(ind, code) {
  const w = waarde(ind, code);
  const ruw = oordeel(w.v, normVan(ind));
  const st = ruw === "ok" && w.onvolledig ? "deels" : ruw;
  const getal = w.v == null ? "–" : fmt(w.v, ind.decimalen || 0);
  const toonChip = S.normen || st === "leeg";
  return `<td class="getal">
    <div class="w">${getal}${w.v == null || !ind.eenheid ? "" : ` <span class="e">${ind.eenheid}</span>`}</div>
    ${w.toel ? `<div class="toel">${w.toel}</div>` : ""}
    ${w.echt && w.v != null ? `<div class="bron-echt">${w.echt}</div>` : ""}
    ${toonChip ? `<div>${chip(st)}</div>` : ""}</td>`;
}

function normCel(ind) {
  const n = normVan(ind);
  if (!S.normen) return `<td><span class="ntype">—</span></td>`;
  if (!n) return `<td><span class="ntype">${SOORT.geen}</span></td>`;
  return `<td><span class="ntype">${SOORT[n.soort]}</span><br><span class="nwaarde">${n.tekst}</span></td>`;
}

function indicatorkaart(ind) {
  const n = normVan(ind);
  const normTekst = n ? `${SOORT[n.soort]}: ${n.tekst}. ${n.document}.` : "Geen norm. Een opvallende waarde is hooguit een signaal.";
  return `<dl class="ikaart">
    <div><dt>Wat het zegt</dt><dd>${ind.vraag}</dd></div>
    <div><dt>Hoe gemeten</dt><dd>${ind.meting}</dd></div>
    <div><dt>Bron</dt><dd>${ind.bron}, per ${ind.niveau}<br><a href="${themaVan(ind).pagina}#i-${ind.sleutel}">Kaart en cijfers per buurt in de ${themaVan(ind).naam}-viewer</a></dd></div>
    <div><dt>Norm</dt><dd>${normTekst}</dd></div>
    <div class="filter${ind.actie ? "" : " leeg"}"><dt>Wat doen we als het rood staat</dt>
      <dd>${ind.actie || "Nog geen handelingsperspectief afgesproken."}</dd></div>
    ${ind.letop ? `<div><dt>Let op</dt><dd>${ind.letop}</dd></div>` : ""}
    ${ind.datalade.ontbreekt ? `<div><dt>Nog niet te zien</dt><dd>${ind.datalade.ontbreekt}</dd></div>` : ""}</dl>`;
}

function tabel(thema) {
  const G = F.gebieden;
  const kolommen = G.length + 2;
  let groep = null;
  const weg = thema.indicatoren.filter((i) => !heeftCijfers(i));
  const rijen = getoond(thema)
    .map((ind) => {
      const kop = ind.groep && ind.groep !== groep ? `<tr class="groep"><th colspan="${kolommen}" scope="colgroup">${ind.groep}</th></tr>` : "";
      groep = ind.groep;
      return `${kop}
      <tr class="ind" data-id="${ind.sleutel}" data-onderwerp="${ind.sleutel}" data-label="${ind.naam}" tabindex="0" aria-expanded="false">
        <td>${ind.naam}</td>${G.map((g) => cel(ind, g.code)).join("")}${normCel(ind)}</tr>
      <tr class="kaart" id="k-${ind.sleutel}" hidden><td colspan="${kolommen}">${indicatorkaart(ind)}</td></tr>`;
    })
    .join("");
  return `<div class="box"><div class="scroll"><table class="agenda">
    <colgroup><col style="width:26%">${G.map(() => `<col style="width:17%">`).join("")}<col style="width:23%"></colgroup>
    <thead><tr><th>Indicator</th>${G.map((g) => `<th class="getal">${g.naam}</th>`).join("")}<th>Norm</th></tr></thead>
    <tbody>${rijen}</tbody></table></div>
    <div class="foot">Bron per waarde: ${[...new Set(getoond(thema).map((ind) => waarde(ind, G[0].code).echt).filter(Boolean))].map((l) => `‘${l}’`).join(", ").replace(/, ([^,]*)$/, " of $1")}. Klik een regel open voor de indicatorkaart. Geen rayontotaal: een gemiddelde van drie gebieden verbergt waar het knelt.${weg.length ? ` Nog zonder cijfers, en daarom niet in dit overzicht: ${weg.map((i) => `<a href="${thema.pagina}#i-${i.sleutel}">${i.naam.toLowerCase()}</a>`).join(", ")}. In de ${thema.naam}-viewer staat per indicator wat je nog niet ziet.` : ""}</div></div>`;
}

function kerncijfers() {
  const alle = F.themas.flatMap(getoond);
  const cellen = alle.flatMap((ind) => F.gebieden.map((g) => oordeel(waarde(ind, g.code).v, normVan(ind))));
  const metNorm = alle.filter((i) => i.norm).length;
  const beleid = alle.filter((i) => normVan(i)?.soort === "beleid").length;
  const rood = cellen.filter((s) => s === "rood").length;
  const leeg = cellen.filter((s) => s === "leeg").length;
  const blokken = [
    [alle.length, `indicatoren met cijfers, van ${alleIndicatoren().length}`],
    [metNorm, `met een norm, waarvan ${beleid} vastgesteld beleid`],
    [S.normen ? rood : "–", "keer ‘voldoet niet’ over drie gebieden", true],
    [alle.length - metNorm, "zonder norm: alleen tonen"],
    [leeg, "gebiedscijfers die ontbreken"],
  ];
  document.getElementById("kerncijfers").innerHTML = blokken
    .map(([n, l, r]) => `<div class="cell${r && S.normen ? " rood" : ""}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`)
    .join("");

  const ovZonderNorm = getoond(F.themas.find((t) => t.sleutel === "ov")).every((i) => !i.norm);
  document.getElementById("gevoeligheid").innerHTML = !S.normen
    ? "<b>Normenlaag uit.</b> Je ziet de cijfers zonder oordeel. Alleen wat ontbreekt, blijft gemarkeerd."
    : `<b>Hoe stevig is dit beeld?</b> Maar ${metNorm} van de ${alle.length} indicatoren hebben een norm, en daarvan is er ${beleid} vastgesteld beleid.${ovZonderNorm ? " OV heeft geen enkele norm en kleurt daardoor nergens rood." : ""}`;
}

function themas() {
  for (const t of F.themas) {
    document.getElementById(`tabel-${t.sleutel}`).innerHTML = tabel(t);
  }
}

function legenda() {
  document.getElementById("legendaOordeel").innerHTML = Object.keys(OORDEEL).map(chip).join("");
}

function alles() {
  veilig("kerncijfers", kerncijfers);
  veilig("themas", themas);
  veilig("legenda", legenda);
  // De reviewmodus hangt zijn velden opnieuw aan de tabellen na elke render.
  document.dispatchEvent(new Event("gerenderd"));
}

// Regel openklikken (muis en toetsenbord).
document.addEventListener("click", (e) => {
  const r = e.target.closest("tr.ind");
  if (!r) return;
  const k = document.getElementById("k-" + r.dataset.id);
  const open = k.hidden;
  k.hidden = !open;
  r.classList.toggle("open", open);
  r.setAttribute("aria-expanded", open);
});
document.addEventListener("keydown", (e) => {
  const r = e.target.closest && e.target.closest("tr.ind");
  if (r && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    r.click();
  }
});

veilig("normschakel", () => {
  const sw = document.getElementById("normSchakel");
  sw.onclick = () => {
    S.normen = !S.normen;
    sw.setAttribute("aria-checked", S.normen);
    document.getElementById("normLabel").textContent = "Normenlaag " + (S.normen ? "aan" : "uit");
    alles();
  };
});

alles();
