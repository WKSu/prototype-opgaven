// Frequentie en haltedekking bij een instelbare norm, uit de verdelingen per buurt in DATALADE.
// Gedeeld door het overzicht en de OV-viewer, zodat beide dezelfde rekenregel volgen. Geen
// interpolatie: de verdelingen staan in klassen die precies op de stappen van de schuifjes vallen.

const OVN = {
  keuzes: () => FUNCTIONEREN.ovKeuzes,
  buurten: (code) => DATALADE.ov.perGebied[code].buurten,
  som: (rij) => rij.reduce((a, n) => a + n, 0),

  // Woonadressen in een buurt met op loopafstand een lijn die minstens perUur keer per uur per
  // richting rijdt in het dagdeel. Klasse k bevat de frequenties vanaf k × stap. Met traject
  // ("1000" of "2000", in meters) tellen lijnen die zo ver dezelfde route rijden samen; zonder
  // telt de beste lijn, de standaard.
  bediendIn(b, dagdeel, perUur, traject = null) {
    const verdeling = traject ? b.bedieningTraject && b.bedieningTraject[traject] : b.bediening;
    if (!verdeling) return 0;
    return OVN.som(verdeling[dagdeel].slice(Math.round(perUur / DATALADE.ov.bediening.stap)));
  },

  // Woonadressen binnen busM lopen van bus of tram, of metroM van metro of trein. Klasse i
  // bevat de afstanden tot en met i stappen.
  gedektIn(b, busM, metroM) {
    const d = DATALADE.ov.dekking;
    const bi = busM / d.busTramStapM, mj = metroM / d.metroTreinStapM;
    return b.dekking.reduce((a, [i, j, n]) => a + (i <= bi || j <= mj ? n : 0), 0);
  },

  // Aandelen per gebied: som over som, dus gewogen naar woonadressen per buurt.
  aandeel(code, teller) {
    const bs = OVN.buurten(code);
    const totaal = OVN.som(bs.map((b) => b.woonadressen));
    return totaal ? (100 * OVN.som(bs.map(teller))) / totaal : null;
  },
  bediend: (code, dagdeel, perUur, traject = null) => OVN.aandeel(code, (b) => OVN.bediendIn(b, dagdeel, perUur, traject)),
  gedekt: (code, busM, metroM) => OVN.aandeel(code, (b) => OVN.gedektIn(b, busM, metroM)),

  // "4 per uur" leest beter als "elk kwartier".
  interval(perUur) {
    const min = 60 / perUur;
    if (min >= 60) return `elke ${String(Math.round((min / 60) * 10) / 10).replace(".", ",")} uur`;
    return min === 15 ? "elk kwartier" : min === 30 ? "elk half uur" : `elke ${Math.round(min)} minuten`;
  },
};
