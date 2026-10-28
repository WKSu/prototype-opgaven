# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Bouwt data/datalade.js: wat de gepubliceerde datalade al zegt over Parkeren en OV.

Leest twee vastgepinde checkouts en schrijft alleen aggregaten per gebied, buurt, sector of
halte. Nooit een adres: de loopbaarheidsdata wordt hier per buurt opgeteld en daarna weggegooid.

    uv run scripts/bouw_datalade.py \\
        --datalade ../wksu/prototype-overschie \\
        --loopbaarheid ../wksu/loopbaarheid-ov/index.html

De commit van elke bron gaat mee in de uitvoer, zodat elk cijfer terug te voeren is op een vaste
versie van de feiten.
"""

import argparse
import csv
import datetime as dt
import io
import json
import math
import re
import subprocess
import zipfile
from pathlib import Path

RAYON = "RAYON_NOORD_BUITEN"
GEBIEDEN = [
    "WK059904",
    "WK059906",
    "WK059914",
]  # uit data/index.js van de datalade, niet getypt

# Haltedekking en frequentie zijn in de viewer instelbaar. Daarom schrijft dit script geen
# cijfer bij één drempel, maar verdelingen per buurt waaruit de browser elke instelling exact
# afleidt. De standaardnormen staan in data/indicatoren.js (ovKeuzes), de onderbouwing van de
# loopafstanden in docs/loopafstanden.md.
LOOP_METRO_TREIN_M = 800  # bereik voor frequentie en meerzijdig; vast, zie hieronder
FREQ_STAP, FREQ_MAX = 0.5, 12  # klassen van de beste frequentie, per uur per richting
DAGDELEN = {
    "os": "ochtendspits (7–9 uur)",
    "dal": "dal (9–16 uur)",
    "av": "avond (18–24 uur)",
}
AFSTAND_BUS_STAP, AFSTAND_BUS_MAX = 50, 1000  # m lopen, klassen voor de dekking
AFSTAND_METRO_STAP, AFSTAND_METRO_MAX = 100, 2000

# Meerzijdige bereikbaarheid: ook keuzes. Bus en tram rekenen met 500 m, omdat de bron per
# halte alleen adreslijsten tot 500 m heeft (1 km bij vier grote knopen); metro en trein met
# 800 m, net als de haltedekking.
LOOP_HALTE_M = 500
BRUIKBAAR_DAL = (
    2  # vertrekken per uur per richting in het dal (09–16): elk half uur of vaker
)
RICHTING_NA_M = 2000  # de windrichting van een lijn is waar hij 2 km verder is
CORRIDOR_OVERLAP = 0.5  # lijnen die de helft van hun haltes delen, vallen samen uit
CENTRUM = "WK059901"  # tangentieel = de lijn komt niet in gebied Rotterdam Centrum
LIJN_MIN_PCT = (
    1  # de buurtkaart noemt een lijn vanaf 1% van de woonadressen van de buurt
)
KNOOP_M = 150  # haltes binnen 150 m van elkaar zijn één overstappunt op de kaart


def lees_const(pad: Path):
    tekst = pad.read_text(encoding="utf-8")
    m = re.search(r"^const (\w+) = (.*);\s*$", tekst, re.MULTILINE | re.DOTALL)
    if not m:
        raise ValueError(f"{pad}: geen 'const NAAM = …;' gevonden")
    return json.loads(m.group(2))


def commit(map_: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(map_), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def json_blok(html: str, blok_id: str):
    m = re.search(
        rf'<script id="{blok_id}" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        raise ValueError(f"loopbaarheid-ov: blok {blok_id} ontbreekt")
    return json.loads(m.group(1))


def eis(obj: dict, *sleutels: str, waar: str):
    # Een hernoemd veld moet luid falen, niet als lege tabel verschijnen.
    ontbreekt = [s for s in sleutels if s not in obj]
    if ontbreekt:
        raise KeyError(f"{waar}: velden ontbreken: {', '.join(ontbreekt)}")


def in_ring(lon: float, lat: float, ring) -> bool:
    binnen = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            binnen = not binnen
    return binnen


def in_vlak(lon: float, lat: float, geometrie) -> bool:
    polygonen = (
        [geometrie["coordinates"]]
        if geometrie["type"] == "Polygon"
        else geometrie["coordinates"]
    )
    for poly in polygonen:
        if in_ring(lon, lat, poly[0]) and not any(
            in_ring(lon, lat, gat) for gat in poly[1:]
        ):
            return True
    return False


def parkeren(datalade: Path) -> dict:
    intern = lees_const(datalade / f"data/{RAYON}/intern.js")
    eis(intern["bronnen"], "parkeersectoren", "autobezit", waar="intern.js")
    ps = intern["bronnen"]["parkeersectoren"]
    eis(
        ps,
        "sectoren",
        "bezettingRegel",
        "caveat",
        "zonderCijfers",
        waar="parkeersectoren",
    )
    velden = [
        "capaciteit",
        "plafond",
        "vergunningenBewoners",
        "vergunningenBedrijven",
        "wachtlijstBewoners",
        "wachtlijstBedrijven",
        "bezetting",
        "bezettingScan",
    ]
    # Een sector kan meerdere gebieden raken; de gebiedsbestanden zeggen welke.
    gebieden_van_sector = {}
    for code in GEBIEDEN:
        for s in lees_const(datalade / f"data/{code}/intern.js")["bronnen"][
            "parkeersectoren"
        ]["sectoren"]:
            gebieden_van_sector.setdefault(s["id"], []).append(code)
    sectoren = [
        {
            "id": s["id"],
            "deelInRayon": s["deelInGebied"],
            "gebieden": gebieden_van_sector.get(s["id"], []),
            **{v: s["cijfers"].get(v) for v in velden},
        }
        for s in ps["sectoren"]
    ]

    ab = intern["bronnen"]["autobezit"]
    eis(ab, "subbuurten", "kaart", "peiljaren", waar="autobezit")
    per_code = {s["code"]: s for s in ab["subbuurten"]}
    # Rotterdamse subbuurtcodes beginnen met het gebiedsnummer (04, 06, 14).
    gebied_van = {code[-2:]: code for code in GEBIEDEN}
    kaart = []
    for f in ab["kaart"]["features"]:
        code = f["properties"]["code"]
        s = per_code[code]
        kaart.append(
            {
                "code": code,
                "naam": s["naam"],
                "gebied": gebied_van[code[:2]],
                "autosPerWoonadres": s["perWoonadres"],
                "woonadressen": s["woonadressen"],
                "geometrie": f["geometry"],
            }
        )
    return {
        "sectoren": {
            "bron": ps["bron"],
            "niveau": ps["niveau"],
            "gebouwd": ps["levering"]["gebouwd"],
            "bezettingRegel": ps["bezettingRegel"],
            "caveat": ps["caveat"],
            "scanCaveat": "Scanautobezetting op een werkdagavond; in de levering gemarkeerd als 'nog niet gevalideerd'.",
            "zonderCijfers": ps["zonderCijfers"],
            "rijen": sectoren,
        },
        "subbuurten": {
            "bron": ab["bron"],
            "niveau": ab["niveau"],
            "peiljaar": ab["peiljaren"][-1],
            "caveat": ab["caveat"],
            "aantalPerGebied": {
                c: sum(1 for k in kaart if k["gebied"] == c) for c in GEBIEDEN
            },
            "kaart": kaart,
        },
    }


def dec_oplopend(s: str) -> list[int]:
    # Adreslijst per halte: oplopende indexen als base36-verschillen.
    uit, vorig = [], 0
    for p in s.split(",") if s else []:
        vorig += int(p, 36)
        uit.append(vorig)
    return uit


def dec_zigzag(s: str) -> list[float]:
    # Coördinaten: zigzag-gecodeerde verschillen in eenheden van 1e-5 graad.
    uit, vorig = [], 0
    for p in s.split(","):
        z = int(p, 36)
        vorig += -((z + 1) >> 1) if z & 1 else z >> 1
        uit.append(vorig / 1e5)
    return uit


COS_LAT = math.cos(math.radians(51.93))


def meter(a, b) -> float:
    return math.hypot((b[0] - a[0]) * 111_320 * COS_LAT, (b[1] - a[1]) * 110_540)


def windrichting(van, naar) -> str:
    graden = (
        math.degrees(math.atan2((naar[0] - van[0]) * COS_LAT, naar[1] - van[1])) % 360
    )
    return "NOZW"[int(((graden + 45) % 360) // 90)]


def richtingen(halte, delen) -> set[str]:
    """Windrichtingen waarin een lijn vanaf deze halte vertrekt: waar hij 2 km verder is.

    Elk deel van de geometrie is meestal één rijrichting; vanaf het dichtstbijzijnde punt lopen
    we in beide richtingen langs de lijn. Een eindpunt (minder dan 500 m lijn over) telt niet."""
    p = (halte["lon"], halte["lat"])
    uit = set()
    for deel in delen:
        j = min(range(len(deel)), key=lambda k: meter(p, deel[k]))
        if meter(p, deel[j]) > 250:
            continue
        for stap in (1, -1):
            k, afstand = j, 0.0
            while 0 <= k + stap < len(deel) and afstand < RICHTING_NA_M:
                afstand += meter(deel[k], deel[k + stap])
                k += stap
            if afstand >= 500:
                uit.add(windrichting(p, deel[k]))
    return uit


def corridors(lijnen, gebruikt) -> list[set]:
    """Storing op een corridor: een lijn valt uit, en met hem de lijnen van dezelfde
    vervoerwijze die minstens de helft van zijn haltes delen (metro A/B/C delen het spoor).

    Gemeten op de hele lijn, niet op de bereikte haltes: anders valt alles samen wat bij
    Alexander stopt. Niet doorgeschakeld: deelt B met A en C met B, dan niet C met A."""
    haltes = {li: set(lijnen[li]["stops"]) for li in gebruikt}

    def deelt(x, y):
        gedeeld = len(haltes[x] & haltes[y])
        drempel = CORRIDOR_OVERLAP * min(len(haltes[x]), len(haltes[y]))
        return lijnen[x]["mode"] == lijnen[y]["mode"] and gedeeld >= drempel

    groepen = {frozenset(y for y in haltes if y == x or deelt(x, y)) for x in haltes}
    return [set(g) for g in groepen]


def corridornaam(lijnen, groep) -> str:
    per_modus = {}
    for li in groep:
        per_modus.setdefault(lijnen[li]["mode"], set()).add(lijnen[li]["nm"])
    return " + ".join(
        f"{m} {'/'.join(sorted(v))}" for m, v in sorted(per_modus.items())
    )


def meerzijdig_gebied(
    buurt_van, n, bereik, lijnen, is_radiaal, richting_van, naam_buurt
) -> dict:
    """De drie maten voor één gebied. buurt_van: adres -> buurt; n: adres -> aantal adressen."""
    adressen = list(buurt_van)
    totaal = sum(n.values())

    def pct(som):
        return round(100 * som / totaal, 1)

    def aandeel(test):
        return pct(sum(n[a] for a in adressen if test(a)))

    lijnen_van = {a: {li for _, li in bereik[a]} for a in adressen}
    modi = {a: {lijnen[li]["mode"] for li in lijnen_van[a]} for a in adressen}
    windr = {a: set().union(*[richting_van[p] for p in bereik[a]]) for a in adressen}
    tang = {a: any(is_radiaal[li] is False for li in lijnen_van[a]) for a in adressen}

    def verliest(a, groep):
        return bool(lijnen_van[a]) and lijnen_van[a] <= groep

    scenario = sorted(
        (
            (sum(n[a] for a in adressen if verliest(a, g)), g)
            for g in corridors(lijnen, set().union(*lijnen_van.values()))
        ),
        key=lambda s: (-s[0], len(s[1])),
    )
    # Bevat een scenario een al genoemd, minstens even zwaar scenario, dan voegen de extra
    # lijnen niets toe: noem alleen de kleinste groep die het verlies veroorzaakt.
    getoond = []
    for verlies, groep in scenario:
        if not any(eerder <= groep for _, eerder in getoond):
            getoond.append((verlies, groep))
    ergste = getoond[0][1]

    def verdeling(waarden):
        return [aandeel(lambda a, k=k: min(len(waarden[a]), 4) == k) for k in range(5)]

    buurten = {}
    for a in adressen:
        b = buurten.setdefault(
            buurt_van[a], {"n": 0, "mix": 0, "tang": 0, "verlies": 0}
        )
        b["n"] += n[a]
        b["mix"] += n[a] * (len(modi[a]) >= 2)
        b["tang"] += n[a] * tang[a]
        b["verlies"] += n[a] * verliest(a, ergste)
    bereikte = {}
    for a in adressen:
        for li in lijnen_van[a]:
            bereikte[li] = bereikte.get(li, 0) + n[a]
    return {
        "woonadressen": totaal,
        "zonderBruikbaar": aandeel(lambda a: not lijnen_van[a]),
        "vervoersmix": {
            "aandeel": aandeel(lambda a: len(modi[a]) >= 2),
            "verdeling": verdeling(modi),
        },
        "richting": {
            "tangentieel": aandeel(lambda a: tang[a]),
            "windrichtingen": verdeling(windr),
            "lijnen": sorted(
                (
                    {
                        "id": li,
                        "lijn": lijnen[li]["nm"],
                        "traject": lijnen[li]["sub"],
                        "modus": lijnen[li]["mode"],
                        "tangentieel": is_radiaal[li] is False,
                        "zonderGeometrie": is_radiaal[li] is None,
                        "bereik": pct(som),
                    }
                    for li, som in bereikte.items()
                ),
                key=lambda x: -x["bereik"],
            ),
        },
        "storing": {
            "corridors": [
                {
                    "corridor": corridornaam(lijnen, g),
                    "lijnen": len(g),
                    "verlies": pct(v),
                }
                for v, g in getoond
            ]
        },
        "perBuurt": sorted(
            (
                {
                    "naam": naam_buurt[b],
                    "woonadressen": v["n"],
                    "mix": round(100 * v["mix"] / v["n"], 1),
                    "tangentieel": round(100 * v["tang"] / v["n"], 1),
                    "verlies": round(100 * v["verlies"] / v["n"], 1),
                }
                for b, v in buurten.items()
            ),
            key=lambda x: x["naam"],
        ),
    }


def storing_rayon(woon, n, bereik, lijnen, naam_buurt) -> list[dict]:
    """Elke corridor in het rayon met het verlies per gebied en per buurt, voor de kiezer.

    De groepen worden over het hele rayon gevormd, niet per gebied. Voor een adres maakt dat
    niet uit: een lijn die het niet bereikt, verandert niet of het al zijn bruikbare lijnen
    kwijtraakt. Daarom komt het verlies per gebied overeen met de tabel per gebied."""
    lijnen_van = {a: {li for _, li in bereik[a]} for a in woon}
    totaal_gebied, totaal_buurt = {}, {}
    for a, (code, b) in woon.items():
        totaal_gebied[code] = totaal_gebied.get(code, 0) + n[a]
        totaal_buurt[b] = totaal_buurt.get(b, 0) + n[a]
    rijen = []
    for g in corridors(lijnen, set().union(*lijnen_van.values())):
        per_gebied, per_buurt = {}, {}
        for a, (code, b) in woon.items():
            if lijnen_van[a] and lijnen_van[a] <= g:
                per_gebied[code] = per_gebied.get(code, 0) + n[a]
                per_buurt[b] = per_buurt.get(b, 0) + n[a]
        if per_buurt:
            rijen.append((sum(per_buurt.values()), g, per_gebied, per_buurt))
    rijen.sort(key=lambda r: (-r[0], len(r[1])))
    getoond = []
    for r in rijen:
        if not any(eerder[1] <= r[1] for eerder in getoond):
            getoond.append(r)
    return [
        {
            "corridor": corridornaam(lijnen, g),
            "lijnen": sorted(g),
            "woonadressen": som,
            "verlies": {
                c: round(100 * per_gebied.get(c, 0) / totaal_gebied[c], 1)
                for c in GEBIEDEN
            },
            "perBuurt": {
                naam_buurt[b]: round(100 * v / totaal_buurt[b], 1)
                for b, v in sorted(per_buurt.items())
            },
        }
        for som, g, per_gebied, per_buurt in getoond
    ]


def bereik_per_adres(data, adressen, pdm, pds) -> dict:
    """Per adres de (halte, lijn)-paren op loopafstand, voor alle lijnen.

    Elke halte op 500 m (1 km bij de vier knopen), plus voor metro en trein het dichtstbijzijnde
    station als dat over het looproutenetwerk binnen 800 m ligt. De bron zegt alleen hoe ver het
    dichtstbijzijnde station is, niet welk; dat kiezen we hemelsbreed. Fijnere afstanden per
    halte heeft de bron niet: daarom is dit bereik vast, ook als de viewer de dekking verschuift."""
    lijnen = data["lijnen"]
    px, py = dec_zigzag(data["px"]), dec_zigzag(data["py"])
    bereik = {a: set() for a in adressen}
    for h in data["haltes"]:
        lijst = dec_oplopend(data["inc500"].get(str(h["id"]), ""))
        lijst += dec_oplopend(data["inc1000"].get(str(h["id"]), ""))
        paren = [(h["id"], li) for li in data["hlk"][h["id"]]]
        for a in lijst:
            if a in bereik:
                bereik[a].update(paren)
    for modus, afstand in (("metro", pdm), ("trein", pds)):
        stations = [h for h in data["haltes"] if modus in h["m"]]
        for a, paren in bereik.items():
            if afstand[a] > LOOP_METRO_TREIN_M:
                continue
            s = min(
                stations, key=lambda h, a=a: meter((px[a], py[a]), (h["lon"], h["lat"]))
            )
            paren.update(
                (s["id"], li)
                for li in data["hlk"][s["id"]]
                if lijnen[li]["mode"] == modus
            )
    return bereik


def meerzijdig(data, html, datalade, woon, alle_paren) -> dict:
    """Vervoersmix, richting-check en storingstest per gebied en buurt, op woonadressen."""
    eis(data, "inc500", "inc1000", "px", "py", "lijnen", waar="loopbaarheid-ov")
    geometrie = {
        f["properties"]["i"]: f["geometry"]["coordinates"]
        for f in json_blok(html, "d-lijnen")["features"]
    }
    lijnen = data["lijnen"]
    dal = data["hlf_keys"].index("dal")
    centrum = [
        f["geometry"]
        for f in lees_const(datalade / f"data/{CENTRUM}/geo.js")["features"]
    ]

    def radiaal(li):
        if li not in geometrie:
            return None  # geen geometrie: onbekend, telt niet als tangentieel
        return any(
            in_vlak(x, y, g) for deel in geometrie[li] for x, y in deel for g in centrum
        )

    # Bruikbare lijnen per halte, met hun vertrekrichtingen.
    is_radiaal = {}
    bruikbaar = {}
    for h in data["haltes"]:
        rij = []
        for li, f in zip(data["hlk"][h["id"]], data["hlf"][h["id"]]):
            if f[dal] >= BRUIKBAAR_DAL:
                if li not in is_radiaal:
                    is_radiaal[li] = radiaal(li)
                rij.append((li, richtingen(h, geometrie.get(li, []))))
        bruikbaar[h["id"]] = rij

    # Bereik: alleen de bruikbare lijnen uit het gedeelde bereik.
    bruikbare_paren = {(h, li) for h, rij in bruikbaar.items() for li, _ in rij}
    bereik = {a: alle_paren[a] & bruikbare_paren for a in woon}
    # Ook de lijnen die nergens bruikbaar zijn, staan op de buurtkaart; die moeten dus ook
    # weten of ze door het centrum rijden.
    for li in {li for paren in alle_paren.values() for _, li in paren}:
        if li not in is_radiaal:
            is_radiaal[li] = radiaal(li)

    richting_van = {(h, li): r for h in bruikbaar for li, r in bruikbaar[h]}
    naam_buurt = {
        f["properties"]["i"]: f["properties"]["n"]
        for f in json_blok(html, "d-buurt")["features"]
    }
    per_gebied = {
        code: meerzijdig_gebied(
            {a: b for a, (g, b) in woon.items() if g == code},
            {a: data["nvo"][a] for a, (g, _) in woon.items() if g == code},
            bereik,
            lijnen,
            is_radiaal,
            richting_van,
            naam_buurt,
        )
        for code in GEBIEDEN
    }
    return {
        "lijnen": {
            li: {
                "lijn": lijnen[li]["nm"],
                "traject": lijnen[li]["sub"],
                "modus": lijnen[li]["mode"],
                "tangentieel": r is False,
                "zonderGeometrie": r is None,
            }
            for li, r in sorted(is_radiaal.items())
        },
        "storing": storing_rayon(woon, data["nvo"], bereik, lijnen, naam_buurt),
        "drempels": {
            "loopHalteM": LOOP_HALTE_M,
            "loopMetroTreinM": LOOP_METRO_TREIN_M,
            "bruikbaarDal": BRUIKBAAR_DAL,
            "richtingNaM": RICHTING_NA_M,
            "corridorOverlap": CORRIDOR_OVERLAP,
            "lijnMinPct": LIJN_MIN_PCT,
            "knopen1km": [data["haltes"][int(k)]["n"] for k in data["inc1000"]],
        },
        "zonderGeometrie": sorted(
            lijnen[li]["nm"] + " " + lijnen[li]["sub"]
            for li, r in is_radiaal.items()
            if r is None
        ),
        "perGebied": per_gebied,
    }


MAANDEN = [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
]


def peildatum_verkenner(html: str) -> dt.date:
    """De dienstregelingsdag van de verkenner, uit zijn eigen tekst ('peildatum 22 september 2026')."""
    m = re.search(
        r"peildatum\s+(\d{1,2})(?:&nbsp;|\s)+([a-z]+)(?:&nbsp;|\s)+(\d{4})", html
    )
    if not m or m.group(2) not in MAANDEN:
        raise ValueError("loopbaarheid-ov: peildatum niet gevonden")
    return dt.date(int(m.group(3)), MAANDEN.index(m.group(2)) + 1, int(m.group(1)))


def uurprofiel_uit_gtfs(zippad: Path, peildatum: dt.date, vlakken: dict) -> dict:
    """Vertrekken per uur van de dag op de peildatum, per gebied: alle ritten die vertrekken
    vanaf een halte binnen de gebiedsgrens. Zelfde regel als de datalade (stap ov), maar op een
    gekozen dag. Tijden na middernacht (24:00+) tellen bij 0–3 uur."""
    ymd = peildatum.strftime("%Y%m%d")

    with zipfile.ZipFile(zippad) as z:

        def rijen(naam):
            r = csv.reader(io.TextIOWrapper(z.open(naam), encoding="utf-8-sig"))
            kop = next(r)
            return ({k: v for k, v in zip(kop, rij)} for rij in r)

        actief = set()
        if "calendar.txt" in z.namelist():
            dag = [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ]
            for r in rijen("calendar.txt"):
                if (
                    r[dag[peildatum.weekday()]] == "1"
                    and r["start_date"] <= ymd <= r["end_date"]
                ):
                    actief.add(r["service_id"])
        for r in rijen("calendar_dates.txt"):
            if r["date"] == ymd:
                (actief.add if r["exception_type"] == "1" else actief.discard)(
                    r["service_id"]
                )

        # Eerst een ruim kader om het rayon, dan precies op de gebiedsgrens.
        hoeken = [
            p
            for g in vlakken.values()
            for v in g
            for poly in (
                v["coordinates"] if v["type"] == "MultiPolygon" else [v["coordinates"]]
            )
            for p in poly[0]
        ]
        lons, lats = [p[0] for p in hoeken], [p[1] for p in hoeken]
        kader = (min(lons) - 0.01, max(lons) + 0.01, min(lats) - 0.01, max(lats) + 0.01)
        gebied_van = {}
        for r in rijen("stops.txt"):
            if not r["stop_lat"]:
                continue
            lon, lat = float(r["stop_lon"]), float(r["stop_lat"])
            if kader[0] <= lon <= kader[1] and kader[2] <= lat <= kader[3]:
                code = next(
                    (
                        c
                        for c in GEBIEDEN
                        if any(in_vlak(lon, lat, g) for g in vlakken[c])
                    ),
                    None,
                )
                if code:
                    gebied_van[r["stop_id"]] = code
        ritten = {r["trip_id"] for r in rijen("trips.txt") if r["service_id"] in actief}
        uren = {c: [0] * 24 for c in GEBIEDEN}
        r = csv.reader(io.TextIOWrapper(z.open("stop_times.txt"), encoding="utf-8-sig"))
        kop = next(r)
        i_rit, i_halte, i_tijd = (
            kop.index(k) for k in ("trip_id", "stop_id", "departure_time")
        )
        for rij in r:
            code = gebied_van.get(rij[i_halte])
            if code and rij[i_tijd] and rij[i_rit] in ritten:
                uren[code][int(rij[i_tijd].split(":")[0]) % 24] += 1
    # Een feed die de dag niet dekt, geeft nul vertrekken; dat is een fout, geen uitkomst.
    leeg = [c for c in GEBIEDEN if not sum(uren[c])]
    if leeg:
        raise ValueError(
            f"{zippad.name}: geen vertrekken op {peildatum} in {', '.join(leeg)}; kies een feed die die dag dekt"
        )
    return uren


def ov(
    datalade: Path,
    loopbaarheid_html: Path,
    gtfs: Path | None = None,
    peildatum: dt.date | None = None,
) -> dict:
    html = loopbaarheid_html.read_text(encoding="utf-8")
    data = json_blok(html, "d-data")
    eis(
        data,
        "haltes",
        "hlk",
        "hlf",
        "hlf_keys",
        "pb",
        "gd",
        "nvo",
        "dhp",
        "pdb",
        "pdt",
        "pdm",
        "pds",
        waar="loopbaarheid-ov",
    )
    buurten = json_blok(html, "d-buurt")["features"]
    dagdeel = {k: data["hlf_keys"].index(k) for k in DAGDELEN}

    # Buurt -> gebied op naam, met een harde controle: elke buurt van de datalade moet precies
    # één keer in de loopbaarheidsdata voorkomen.
    lb_buurt = {f["properties"]["n"]: f["properties"]["i"] for f in buurten}
    gebied_van_buurt, vlakken, buurten_per_gebied = {}, {}, {}
    for code in GEBIEDEN:
        geo = lees_const(datalade / f"data/{code}/geo.js")
        buurten_per_gebied[code] = []
        for f in geo["features"]:
            naam = f["properties"]["naam"]
            if naam not in lb_buurt:
                raise KeyError(f"buurt {naam!r} ({code}) ontbreekt in loopbaarheid-ov")
            gebied_van_buurt[lb_buurt[naam]] = code
            vlakken.setdefault(code, []).append(f["geometry"])
            buurten_per_gebied[code].append(
                {
                    "naam": naam,
                    "i": lb_buurt[naam],
                    "inwoners": f["properties"].get("inwoners"),
                    "geometrie": f["geometry"],
                }
            )

    # Afstanden staan per adrespunt in stappen van 10 m (201 = verder dan 2 km); het gewicht is
    # het aantal adressen in het pand. Alleen panden met een woonfunctie binnen de gemeente.
    def dec2(s):
        return [min(int(s[i : i + 2], 36), 201) * 10 for i in range(0, len(s), 2)]

    pdb, pdt, pdm, pds = (dec2(data[k]) for k in ("pdb", "pdt", "pdm", "pds"))
    pb = [int(data["pb"][i : i + 2], 36) for i in range(0, len(data["pb"]), 2)]
    gd = [int(data["gd"][i : i + 2], 36) for i in range(0, len(data["gd"]), 2)]
    woon = {
        i: (gebied_van_buurt[b], b)
        for i, b in enumerate(pb)
        if b in gebied_van_buurt and data["dhp"][i] and gd[i] & 1
    }
    alle_paren = bereik_per_adres(data, woon, pdm, pds)
    freq = {
        (h["id"], li): f
        for h in data["haltes"]
        for li, f in zip(data["hlk"][h["id"]], data["hlf"][h["id"]])
    }

    # Dekking: woonadressen per buurt naar loopafstand tot bus/tram en tot metro/trein, in
    # klassen. Klasse k = afstand tot en met k stappen; de laatste klasse is 'verder'. De viewer
    # telt bij elke instelling de klassen op, dus de uitkomst is exact, niet geïnterpoleerd.
    def klasse(d, stap, maximum):
        return min(-(-d // stap), maximum // stap + 1)

    dekking, bediening, lijn_buurt = {}, {}, {}
    nb = FREQ_MAX / FREQ_STAP + 1  # laatste klasse: FREQ_MAX of meer
    for a, (_, b) in woon.items():
        n = data["nvo"][a]
        # Buurtkaart: per lijn de woonadressen die hem op loopafstand hebben, en hoe vaak hij
        # rijdt aan de beste halte die een van die adressen bereikt, per dagdeel.
        beste = {}
        for p in alle_paren[a]:
            vorig = beste.get(p[1], [0] * len(dagdeel))
            beste[p[1]] = [max(x, freq[p][j]) for x, j in zip(vorig, dagdeel.values())]
        for li, fr in beste.items():
            cel = lijn_buurt.setdefault(b, {}).setdefault(li, [0, [0] * len(dagdeel)])
            cel[0] += n
            cel[1] = [max(x, y) for x, y in zip(cel[1], fr)]
        i = klasse(min(pdb[a], pdt[a]), AFSTAND_BUS_STAP, AFSTAND_BUS_MAX)
        j = klasse(min(pdm[a], pds[a]), AFSTAND_METRO_STAP, AFSTAND_METRO_MAX)
        cel = dekking.setdefault(b, {})
        cel[(i, j)] = cel.get((i, j), 0) + n
        # Frequentie: de beste lijn op loopafstand, per dagdeel, in vertrekken per uur per
        # richting. Een adres zonder enige lijn op loopafstand telt apart.
        v = bediening.setdefault(
            b, {"geenLijn": 0, **{k: [0] * int(nb) for k in DAGDELEN}}
        )
        if not alle_paren[a]:
            v["geenLijn"] += n
            continue
        for k, j_dd in dagdeel.items():
            beste = max(freq[p][j_dd] for p in alle_paren[a])
            v[k][min(int(beste / FREQ_STAP), int(nb) - 1)] += n

    def halte_gebied(h):
        return next(
            (
                c
                for c in GEBIEDEN
                if any(in_vlak(h["lon"], h["lat"], g) for g in vlakken[c])
            ),
            None,
        )

    haltes = {code: [] for code in GEBIEDEN}
    for h in data["haltes"]:
        code = halte_gebied(h)
        if code is None:
            continue
        rij = [freq[(h["id"], li)] for li in data["hlk"][h["id"]]]
        haltes[code].append(
            {
                "naam": h["n"],
                "lon": h["lon"],
                "lat": h["lat"],
                "modi": h["m"],
                **{k: max((f[j] for f in rij), default=0) for k, j in dagdeel.items()},
            }
        )

    # Overstappunten: haltes die dicht bij elkaar liggen (de metrohalte en de busperrons
    # ernaast) worden één punt. Per lijn telt de beste halte van het punt, één keer; zo zie je
    # hoeveel er bij een knoop samenkomt, naast de beste lijn waar de indicator op rekent.
    def knopen_in(code):
        leden = [
            h
            for h in data["haltes"]
            if halte_gebied(h) == code
            and any(sum(freq[(h["id"], li)]) for li in data["hlk"][h["id"]])
        ]
        groep = list(range(len(leden)))

        def wortel(i):
            while groep[i] != i:
                i = groep[i]
            return i

        for i, a in enumerate(leden):
            for j in range(i):
                b = leden[j]
                if meter((a["lon"], a["lat"]), (b["lon"], b["lat"])) <= KNOOP_M:
                    groep[wortel(i)] = wortel(j)
        per = {}
        for i, h in enumerate(leden):
            per.setdefault(wortel(i), []).append(h)
        uit = []
        for hs in per.values():
            lijn = {}
            for h in hs:
                for li in data["hlk"][h["id"]]:
                    f = [freq[(h["id"], li)][j] for j in dagdeel.values()]
                    lijn[li] = [max(x, y) for x, y in zip(lijn.get(li, f), f)]
            # De naam van de halte met de snelste soort OV, bij gelijke soort de meeste lijnen.
            hoofd = min(
                hs,
                key=lambda h: (
                    min(("trein", "metro", "tram", "bus").index(m) for m in h["m"]),
                    -len(data["hlk"][h["id"]]),
                ),
            )
            modi = {m for h in hs for m in h["m"]}
            uit.append(
                {
                    "naam": hoofd["n"],
                    "lon": round(sum(h["lon"] for h in hs) / len(hs), 6),
                    "lat": round(sum(h["lat"] for h in hs) / len(hs), 6),
                    "modi": [m for m in ("bus", "tram", "metro", "trein") if m in modi],
                    "haltes": len(hs),
                    "lijnen": sum(1 for f in lijn.values() if any(f)),
                    **{
                        k: {
                            "beste": max(f[n] for f in lijn.values()),
                            "samen": round(sum(f[n] for f in lijn.values()), 1),
                        }
                        for n, k in enumerate(dagdeel)
                    },
                }
            )
        return sorted(uit, key=lambda k: k["naam"])

    def lijnen_in(b):
        totaal = sum(dekking.get(b, {}).values())
        rijen = [
            [li, round(100 * som / totaal, 1), *fr]
            for li, (som, fr) in lijn_buurt.get(b, {}).items()
            if 100 * som / totaal >= LIJN_MIN_PCT
        ]
        return sorted(rijen, key=lambda r: (-r[1], r[0]))

    # Uurprofiel: standaard uit de datalade, op de dag waarop die gebouwd is. Met een eigen
    # GTFS-feed op de dag van de verkenner, zodat het profiel en de cijfers per adres op
    # dezelfde dienstregeling rusten (de datalade-dag kan in de zomervakantie vallen).
    dag_verkenner = peildatum_verkenner(html)
    eigen = (
        uurprofiel_uit_gtfs(gtfs, peildatum or dag_verkenner, vlakken) if gtfs else None
    )
    per_gebied = {}
    for code in GEBIEDEN:
        ovg = lees_const(datalade / f"data/{code}/ov.js")
        eis(ovg, "lijnen", "vertrekPerUur", "peildatum", waar=f"{code}/ov.js")
        datalade_uren = [
            sum(reeks[u] for reeks in ovg["vertrekPerUur"].values()) for u in range(24)
        ]
        # Een feed zonder één vervoerder (RET publiceert per periode) geeft niet nul, maar
        # veel te weinig. Zomer tegen gewoon scheelt een kwart; minder dan de helft is een gat.
        if eigen and sum(eigen[code]) < 0.5 * sum(datalade_uren):
            raise ValueError(
                f"{gtfs.name}: {sum(eigen[code])} vertrekken in {code}, tegen "
                f"{sum(datalade_uren)} in de datalade; de feed dekt die dag niet volledig"
            )
        uren = eigen[code] if eigen else datalade_uren
        per_gebied[code] = {
            "buurten": [
                {
                    "naam": b["naam"],
                    "inwoners": b["inwoners"],
                    "woonadressen": sum(dekking.get(b["i"], {}).values()),
                    "geometrie": b["geometrie"],
                    "bediening": bediening.get(b["i"]),
                    "dekking": sorted(
                        [i, j, n] for (i, j), n in dekking.get(b["i"], {}).items()
                    ),
                    "lijnen": lijnen_in(b["i"]),
                }
                for b in buurten_per_gebied[code]
            ],
            "haltes": sorted(haltes[code], key=lambda h: h["naam"]),
            "knopen": knopen_in(code),
            "uurprofiel": uren,
            "gtfsPeildatum": (peildatum or dag_verkenner).isoformat()
            if eigen
            else ovg["peildatum"],
            "gtfsBron": f"GTFS NDOV/OVapi ({gtfs.name})" if eigen else ovg["bron"],
        }
    mz = meerzijdig(data, html, datalade, woon, alle_paren)
    for code in GEBIEDEN:
        per_gebied[code]["meerzijdig"] = mz["perGebied"][code]
    # Lijnen die geen buurt op de kaart noemt, hoeven niet in de lijnentabel.
    genoemd = {
        r[0] for g in per_gebied.values() for b in g["buurten"] for r in b["lijnen"]
    } | {li for c in mz["storing"] for li in c["lijnen"]}
    genoemd |= {
        x["id"] for g in mz["perGebied"].values() for x in g["richting"]["lijnen"]
    }
    return {
        "lijnen": {li: v for li, v in mz["lijnen"].items() if li in genoemd},
        "meerzijdig": {k: v for k, v in mz.items() if k not in ("perGebied", "lijnen")},
        "bediening": {"dagdelen": DAGDELEN, "stap": FREQ_STAP, "max": FREQ_MAX},
        "dekking": {
            "busTramStapM": AFSTAND_BUS_STAP,
            "busTramMaxM": AFSTAND_BUS_MAX,
            "metroTreinStapM": AFSTAND_METRO_STAP,
            "metroTreinMaxM": AFSTAND_METRO_MAX,
        },
        "loopbaarheidBron": "loopbaarheid-ov: CHB en GTFS via NDOV/OVapi, BAG via PDOK, looproutes uit OSM",
        "peildatum": dag_verkenner.isoformat(),
        "perGebied": per_gebied,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--datalade",
        type=Path,
        required=True,
        help="checkout van WKSu/prototype-overschie",
    )
    ap.add_argument(
        "--loopbaarheid",
        type=Path,
        required=True,
        help="index.html van WKSu/loopbaarheid-ov",
    )
    ap.add_argument(
        "--gtfs",
        type=Path,
        help="GTFS-feed (zip) die de dag van de verkenner dekt; dan rekent het uurprofiel op die dag",
    )
    ap.add_argument(
        "--peildatum",
        type=dt.date.fromisoformat,
        help="andere dag voor het uurprofiel, alleen ter controle (bijvoorbeeld 2026-08-11)",
    )
    ap.add_argument(
        "--uit",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data/datalade.js",
    )
    a = ap.parse_args()

    uit = {
        "bronnen": {
            "datalade": {
                "repo": "WKSu/prototype-overschie",
                "url": "https://wksu.github.io/prototype-overschie/",
                "commit": commit(a.datalade),
            },
            "loopbaarheid": {
                "repo": "WKSu/loopbaarheid-ov",
                "url": "https://wksu.github.io/loopbaarheid-ov/",
                "commit": commit(a.loopbaarheid.parent),
            },
        },
        "gebieden": GEBIEDEN,
        "parkeren": parkeren(a.datalade),
        "ov": ov(a.datalade, a.loopbaarheid, a.gtfs, a.peildatum),
    }
    tekst = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_datalade.py. Niet met de hand bewerken.\n"
        f"const DATALADE = {tekst};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(tekst) / 1024:.0f} kB")


if __name__ == "__main__":
    main()
