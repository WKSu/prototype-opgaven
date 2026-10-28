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
import json
import re
import subprocess
from pathlib import Path

RAYON = "RAYON_NOORD_BUITEN"
GEBIEDEN = [
    "WK059904",
    "WK059906",
    "WK059914",
]  # uit data/index.js van de datalade, niet getypt

# Drempels voor haltedekking en frequentie: keuzes, geen normen. Ze staan hier zodat ze niet in
# de rekenregels verdwijnen; de definitie in data/indicatoren.js noemt dezelfde getallen.
LOOP_BUS_TRAM_M = 400
LOOP_METRO_TREIN_M = 800
AVOND_MIN_PER_RICHTING = 4


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


def ov(datalade: Path, loopbaarheid_html: Path) -> dict:
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
    lijnen_lb = data["lijnen"]
    avond = data["hlf_keys"].index("av")

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
                }
            )

    # Haltedekking over het looproutenetwerk, per buurt. Afstanden staan per adrespunt in
    # stappen van 10 m (201 = verder dan 2 km); het gewicht is het aantal adressen in het pand.
    def dec2(s):
        return [min(int(s[i : i + 2], 36), 201) * 10 for i in range(0, len(s), 2)]

    pdb, pdt, pdm, pds = (dec2(data[k]) for k in ("pdb", "pdt", "pdm", "pds"))
    pb = [int(data["pb"][i : i + 2], 36) for i in range(0, len(data["pb"]), 2)]
    gd = [int(data["gd"][i : i + 2], 36) for i in range(0, len(data["gd"]), 2)]
    totaal, gedekt = {}, {}
    for i, b in enumerate(pb):
        if b not in gebied_van_buurt or not data["dhp"][i] or not (gd[i] & 1):
            continue  # alleen panden met een woonfunctie binnen de gemeente
        n = data["nvo"][i]
        totaal[b] = totaal.get(b, 0) + n
        if (
            min(pdb[i], pdt[i]) <= LOOP_BUS_TRAM_M
            or min(pdm[i], pds[i]) <= LOOP_METRO_TREIN_M
        ):
            gedekt[b] = gedekt.get(b, 0) + n

    # Frequentie: een halte telt mee als minstens één lijn er in de avond (18–24 uur) gemiddeld
    # het drempelaantal vertrekken per uur per richting haalt.
    haltes = {code: [] for code in GEBIEDEN}
    for h in data["haltes"]:
        code = next(
            (
                c
                for c in GEBIEDEN
                if any(in_vlak(h["lon"], h["lat"], g) for g in vlakken[c])
            ),
            None,
        )
        if code is None:
            continue
        per_lijn = [
            {
                "lijn": lijnen_lb[li]["nm"],
                "modus": lijnen_lb[li]["mode"],
                "avond": f[avond],
            }
            for li, f in zip(data["hlk"][h["id"]], data["hlf"][h["id"]])
        ]
        beste = max((x["avond"] for x in per_lijn), default=0)
        haltes[code].append(
            {
                "naam": h["n"],
                "modi": h["m"],
                "avondMax": beste,
                "voldoet": beste >= AVOND_MIN_PER_RICHTING,
                "lijnen": sorted(per_lijn, key=lambda x: -x["avond"]),
            }
        )

    per_gebied = {}
    for code in GEBIEDEN:
        ovg = lees_const(datalade / f"data/{code}/ov.js")
        eis(ovg, "lijnen", "vertrekPerUur", "peildatum", waar=f"{code}/ov.js")
        uren = [
            sum(reeks[u] for reeks in ovg["vertrekPerUur"].values()) for u in range(24)
        ]
        bb = buurten_per_gebied[code]
        tot = sum(totaal.get(b["i"], 0) for b in bb)
        ged = sum(gedekt.get(b["i"], 0) for b in bb)
        hs = sorted(haltes[code], key=lambda h: h["naam"])
        per_gebied[code] = {
            "frequentie": {
                "haltes": len(hs),
                "voldoen": sum(h["voldoet"] for h in hs),
                "haltesLijst": hs,
            },
            "dekking": {
                "woonadressen": tot,
                "gedekt": ged,
                "aandeel": round(100 * ged / tot, 1) if tot else None,
                "perBuurt": [
                    {
                        "naam": b["naam"],
                        "inwoners": b["inwoners"],
                        "woonadressen": totaal.get(b["i"], 0),
                        "aandeel": round(
                            100 * gedekt.get(b["i"], 0) / totaal[b["i"]], 1
                        )
                        if totaal.get(b["i"])
                        else None,
                    }
                    for b in bb
                ],
            },
            "uurprofiel": uren,
            "lijnen": [
                {
                    k: l.get(k)
                    for k in (
                        "lijn",
                        "soort",
                        "traject",
                        "ritten",
                        "eerste",
                        "laatste",
                        "binnenWijk",
                    )
                }
                for l in sorted(ovg["lijnen"], key=lambda l: (l["soort"], -l["ritten"]))
            ],
            "gtfsPeildatum": ovg["peildatum"],
            "gtfsBron": ovg["bron"],
        }
    return {
        "drempels": {
            "busTramM": LOOP_BUS_TRAM_M,
            "metroTreinM": LOOP_METRO_TREIN_M,
            "avondPerRichting": AVOND_MIN_PER_RICHTING,
        },
        "loopbaarheidBron": "loopbaarheid-ov: CHB en GTFS via NDOV/OVapi, BAG via PDOK, looproutes uit OSM",
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
        "ov": ov(a.datalade, a.loopbaarheid),
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
