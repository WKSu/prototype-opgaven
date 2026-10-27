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

const STATUS = {
  ja: "Beantwoord in de datalade",
  deels: "Deels in de datalade",
  nee: "Niet in de datalade",
};

// Waar de datalade het antwoord al heeft, vervangt het echte cijfer het fictieve. Ontbreekt
// data/datalade.js, dan blijft de mock-up staan.
const UIT_DATALADE = {
  "ov-frequentie": (code) => {
    const f = DATALADE.ov.perGebied[code].frequentie;
    return { v: Math.round((100 * f.voldoen) / f.haltes), toel: `${f.voldoen} van ${f.haltes} haltes` };
  },
  "ov-haltedekking": (code) => {
    const d = DATALADE.ov.perGebied[code].dekking;
    return { v: d.aandeel, toel: "over het looproutenetwerk" };
  },
};
function waarde(ind, code) {
  const echt = typeof DATALADE !== "undefined" && UIT_DATALADE[ind.sleutel];
  if (echt) return { ...echt(code), echt: true };
  return ind.waarden[code] || { v: null };
}
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
  const st = oordeel(w.v, normVan(ind));
  const getal = w.v == null ? "–" : fmt(w.v, ind.decimalen || 0);
  const toonChip = S.normen || st === "leeg";
  return `<td class="getal">
    <div class="w">${getal}${w.v == null || !ind.eenheid ? "" : ` <span class="e">${ind.eenheid}</span>`}</div>
    ${w.toel ? `<div class="toel">${w.toel}</div>` : ""}
    ${w.echt ? `<div class="bron-echt">datalade</div>` : ""}
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
    <div><dt>Wat meet het</dt><dd>${ind.definitie}</dd></div>
    <div><dt>Niveau en bron</dt><dd>${ind.niveau} · ${ind.bron}</dd></div>
    <div><dt>Beschikbaar volgens themateam</dt><dd>${ind.data}</dd></div>
    <div><dt>In de datalade</dt><dd><span class="oordeel o-${ind.datalade.status}">${STATUS[ind.datalade.status]}</span>
      <br><a href="${themaVan(ind).pagina}#i-${ind.sleutel}">Bekijk in de ${themaVan(ind).naam}-viewer</a></dd></div>
    <div><dt>Norm</dt><dd>${normTekst}</dd></div>
    <div class="filter${ind.actie ? "" : " leeg"}"><dt>Wat doen we als het rood staat</dt>
      <dd>${ind.actie || "Nog geen handelingsperspectief afgesproken."}</dd></div>
    ${ind.letop ? `<div><dt>Let op</dt><dd>${ind.letop}</dd></div>` : ""}</dl>`;
}

function tabel(thema) {
  const G = F.gebieden;
  const kolommen = G.length + 2;
  let groep = null;
  const rijen = thema.indicatoren
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
    <div class="foot">Waarden fictief, behalve waar ‘datalade’ staat. Klik een regel open voor de indicatorkaart. Geen rayontotaal: een gemiddelde van drie gebieden verbergt waar het knelt.</div></div>`;
}

function kerncijfers() {
  const alle = alleIndicatoren();
  const cellen = alle.flatMap((ind) => F.gebieden.map((g) => oordeel(waarde(ind, g.code).v, normVan(ind))));
  const metNorm = alle.filter((i) => i.norm).length;
  const beleid = alle.filter((i) => normVan(i)?.soort === "beleid").length;
  const rood = cellen.filter((s) => s === "rood").length;
  const leeg = cellen.filter((s) => s === "leeg").length;
  const blokken = [
    [alle.length, "indicatoren voor Parkeren en OV"],
    [metNorm, `met een norm, waarvan ${beleid} vastgesteld beleid`],
    [S.normen ? rood : "–", "keer ‘voldoet niet’ over drie gebieden", true],
    [alle.length - metNorm, "zonder norm: alleen tonen"],
    [leeg, "gebiedscijfers die ontbreken"],
  ];
  document.getElementById("kerncijfers").innerHTML = blokken
    .map(([n, l, r]) => `<div class="cell${r && S.normen ? " rood" : ""}"><div class="num">${n}</div><div class="lbl">${l}</div><div class="src">mock-up</div></div>`)
    .join("");

  const ovZonderNorm = F.themas.find((t) => t.sleutel === "ov").indicatoren.every((i) => !i.norm);
  document.getElementById("gevoeligheid").innerHTML = !S.normen
    ? "<b>Normenlaag uit.</b> Je ziet de cijfers neutraal, zoals in de datalade. Alleen wat ontbreekt, blijft gemarkeerd."
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
