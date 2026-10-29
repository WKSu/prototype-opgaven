# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2"]
# ///
"""Bouwt data/toegankelijkheid.js: hoe toegankelijk de perrons van bus, tram en metro zijn.

Per perron (CHB: quay) het oordeel van het Centraal Haltebestand: toegankelijk voor reizigers
met een rolstoel of rollator (motorisch) en voor reizigers met een visuele beperking, met de
maten erachter (perronhoogte, geleidelijn). Het beleidskader dat het kader geeft, staat in
data_manual/beleidskader toegankelijk ov (MRDH, Beleidskader Toegankelijk OV 2024).

    uv run scripts/bouw_toegankelijkheid.py

Alleen perrons waar op de peildatum van de OV-viewer (dinsdag 22 september 2026) iets
vertrekt, volgens dezelfde GTFS-feed als het uurprofiel. Het aantal vertrekken per perron gaat
mee: het beleidskader geeft de drukste haltes voorrang. Leest data/datalade.js voor de buurten
en de peildatum; draai dus eerst scripts/bouw_datalade.py.

De export van het CHB staat dagelijks op https://data.ndovloket.nl/haltes/ (open data, DOVA);
zet hem in data_manual/chb/. Zonder --chb neemt het script de nieuwste.
"""

import argparse
import csv
import datetime as dt
import gzip
import io
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from bouw_datalade import GEBIEDEN, in_vlak, lees_const
from bouw_ovkaart import rd2wgs

ROOT = Path(__file__).resolve().parent.parent
NS = "{http://bison.connekt.nl/tmi8/chb/msg}"
MODI = (
    "bus",
    "tram",
    "metro",
)  # BTM-haltes; treinperrons (ProRail) staan niet in het CHB
GTFS_MODUS = {"0": "tram", "1": "metro", "3": "bus"}  # route_type
# Een GTFS-halte is het dichtstbijzijnde CHB-perron van dezelfde soort binnen deze afstand. Een
# metroperron is lang en het GTFS-punt ligt niet waar het CHB-punt ligt: tot 150 m. Een bus
# stopt ook aan een tramperron (combihalte).
KOPPEL_M = {"bus": 25, "tram": 25, "metro": 150}
PERRON_VOOR = {"bus": ("bus", "tram"), "tram": ("tram",), "metro": ("metro",)}
OORDEEL = {"Y": True, "N": False}  # U (onbekend) wordt null


def meter(a, b) -> float:
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    return math.hypot(dx, (a[1] - b[1]) * 110540)


def tekst(el, pad: str):
    # "a/b" → "{ns}a/{ns}b": het CHB zet elk element in zijn namespace.
    e = el.find("/".join(NS + deel for deel in pad.split("/")))
    return e.text if e is not None else None


def buurt_van(lon: float, lat: float, buurten: list):
    return next(
        (b for b in buurten if in_vlak(lon, lat, b["geometrie"])),
        None,
    )


def perrons_uit_chb(pad: Path, buurten: list) -> tuple[list, dict]:
    """Alle perrons van bus, tram en metro in een buurt van het rayon, met status available."""
    lons = [p[0] for b in buurten for poly in polys(b) for p in poly[0]]
    lats = [p[1] for b in buurten for poly in polys(b) for p in poly[0]]
    kader = (min(lons), max(lons), min(lats), max(lats))
    uit, overgeslagen = [], {"status": 0, "soort": 0}
    with gzip.open(pad) as f:
        for _, el in ET.iterparse(f):
            if el.tag != NS + "stopplace":
                continue
            halte = tekst(el, "stopplacename/publicname")
            for q in el.iter(NS + "quay"):
                x, y = (tekst(q, f"quaylocationdata/rd-{a}") for a in "xy")
                if x is None or y is None:
                    continue
                lon, lat = rd2wgs(float(x), float(y))
                if not (kader[0] <= lon <= kader[1] and kader[2] <= lat <= kader[3]):
                    continue
                b = buurt_van(lon, lat, buurten)
                if b is None:
                    continue
                if tekst(q, "quaystatusdata/quaystatus") != "available":
                    overgeslagen["status"] += 1
                    continue
                modus = tekst(q, "quaytransportmodes/transportmodedata/transportmode")
                if modus not in MODI:
                    overgeslagen["soort"] += 1
                    continue
                vis = q.find(NS + "quayvisuallyaccessible")
                dis = q.find(NS + "quaydisabledaccessible")
                aa = q.find(NS + "quayaccessibilityadaptions")
                if vis is None or dis is None:
                    raise KeyError(f"CHB: toegankelijkheid ontbreekt bij {halte}")
                hoogte = aa.find(NS + "kerbheight") if aa is not None else None
                lijn = aa.find(NS + "guidelines") if aa is not None else None
                uit.append(
                    {
                        "code": tekst(q, "quaycode").removeprefix("NL:Q:"),
                        "halte": halte,
                        "gebied": b["gebied"],
                        "buurt": b["naam"],
                        "modus": modus,
                        "lon": round(lon, 6),
                        "lat": round(lat, 6),
                        "rolstoel": OORDEEL.get(
                            dis.find(NS + "disabledaccessible").text
                        ),
                        "visueel": OORDEEL.get(
                            vis.find(NS + "visuallyaccessible").text
                        ),
                        # 0,01 m is in het CHB 'niet ingevuld'.
                        "perronhoogteCm": (
                            round(float(hoogte.text) * 100)
                            if hoogte is not None and float(hoogte.text) > 0.011
                            else None
                        ),
                        "geleidelijn": (
                            lijn.text == "true" if lijn is not None else None
                        ),
                    }
                )
            el.clear()
    return uit, overgeslagen


def polys(b):
    g = b["geometrie"]
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]


def vertrekken_per_halte(zippad: Path, peildatum: dt.date, kader) -> tuple:
    """Vertrekken op de peildatum per GTFS-halte binnen het kader en per soort OV, met hun
    ligging. Alleen stops waar je kunt instappen (pickup_type niet 1): het eindpunt van een
    rit telt niet."""
    ymd = peildatum.strftime("%Y%m%d")
    with zipfile.ZipFile(zippad) as z:

        def rijen(naam):
            r = csv.reader(io.TextIOWrapper(z.open(naam), encoding="utf-8-sig"))
            kop = next(r)
            return ({k: v for k, v in zip(kop, rij)} for rij in r)

        actief = set()
        for r in rijen("calendar_dates.txt"):
            if r["date"] == ymd:
                (actief.add if r["exception_type"] == "1" else actief.discard)(
                    r["service_id"]
                )
        ligging = {}
        for r in rijen("stops.txt"):
            if not r["stop_lat"]:
                continue
            lon, lat = float(r["stop_lon"]), float(r["stop_lat"])
            if kader[0] <= lon <= kader[1] and kader[2] <= lat <= kader[3]:
                ligging[r["stop_id"]] = (lon, lat)
        soort = {
            r["route_id"]: GTFS_MODUS[r["route_type"]]
            for r in rijen("routes.txt")
            if r["route_type"] in GTFS_MODUS
        }
        ritten = {
            r["trip_id"]: soort[r["route_id"]]
            for r in rijen("trips.txt")
            if r["service_id"] in actief and r["route_id"] in soort
        }
        n = {}
        r = csv.reader(io.TextIOWrapper(z.open("stop_times.txt"), encoding="utf-8-sig"))
        kop = next(r)
        i_rit, i_halte, i_in = (
            kop.index(k) for k in ("trip_id", "stop_id", "pickup_type")
        )
        for rij in r:
            if rij[i_halte] in ligging and rij[i_in] != "1" and rij[i_rit] in ritten:
                k = (rij[i_halte], ritten[rij[i_rit]])
                n[k] = n.get(k, 0) + 1
    if not n:
        raise ValueError(f"{zippad.name}: geen vertrekken op {peildatum}")
    return ligging, n


def tel(perrons: list) -> dict:
    def som(test, veld=None):
        return sum((p[veld] if veld else 1) for p in perrons if test(p))

    return {
        "perrons": len(perrons),
        "beide": som(lambda p: p["rolstoel"] and p["visueel"]),
        "alleenRolstoel": som(lambda p: p["rolstoel"] and p["visueel"] is False),
        "alleenVisueel": som(lambda p: p["rolstoel"] is False and p["visueel"]),
        "geen": som(lambda p: p["rolstoel"] is False and p["visueel"] is False),
        "onbekend": som(lambda p: p["rolstoel"] is None or p["visueel"] is None),
        "vertrekken": som(lambda p: True, "vertrekken"),
        "vertrekkenBeide": som(lambda p: p["rolstoel"] and p["visueel"], "vertrekken"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--chb", type=Path, help="ExportCHB_<datum>.xml.gz")
    ap.add_argument(
        "--gtfs", type=Path, default=ROOT / "data_manual/gtfs/NL-20260922.gtfs.zip"
    )
    ap.add_argument("--uit", type=Path, default=ROOT / "data/toegankelijkheid.js")
    a = ap.parse_args()
    chb = a.chb or max((ROOT / "data_manual/chb").glob("ExportCHB_*.xml.gz"))

    ov = lees_const(ROOT / "data/datalade.js")["ov"]
    peildatum = dt.date.fromisoformat(ov["peildatum"])
    buurten = [
        {**b, "gebied": code}
        for code in GEBIEDEN
        for b in ov["perGebied"][code]["buurten"]
    ]
    perrons, overgeslagen = perrons_uit_chb(chb, buurten)

    m = 0.002  # ruim kader, zodat een GTFS-punt net over de buurtgrens ook meedoet
    kader = (
        min(p["lon"] for p in perrons) - m,
        max(p["lon"] for p in perrons) + m,
        min(p["lat"] for p in perrons) - m,
        max(p["lat"] for p in perrons) + m,
    )
    ligging, vertrekken = vertrekken_per_halte(a.gtfs, peildatum, kader)
    # Dichtstbijzijnde paren eerst. Bij de metro één GTFS-halte per perron: beide sporen
    # liggen aan hetzelfde lange perron, en anders vallen ze samen op het dichtste CHB-punt.
    paren = sorted(
        (meter(ligging[stop], (p["lon"], p["lat"])), stop, modus, i)
        for stop, modus in vertrekken
        for i, p in enumerate(perrons)
        if p["modus"] in PERRON_VOOR[modus]
    )
    for p in perrons:
        p["vertrekken"] = 0
    gekoppeld, bezet = set(), set()
    for afstand, stop, modus, i in paren:
        if afstand > KOPPEL_M[modus] or (stop, modus) in gekoppeld or i in bezet:
            continue
        gekoppeld.add((stop, modus))
        if modus == "metro":
            bezet.add(i)
        perrons[i]["vertrekken"] += vertrekken[(stop, modus)]
    los = sum(
        n
        for (stop, modus), n in vertrekken.items()
        if (stop, modus) not in gekoppeld and buurt_van(*ligging[stop], buurten)
    )
    stil = [p for p in perrons if not p["vertrekken"]]
    perrons = sorted(
        (p for p in perrons if p["vertrekken"]),
        key=lambda p: (p["gebied"], p["halte"], p["code"]),
    )

    print(f"{chb.name}: {len(perrons)} perrons in dienst op {peildatum}")
    print(
        f"  niet meegeteld: {overgeslagen['status']} niet in gebruik, "
        f"{overgeslagen['soort']} veer, {len(stil)} zonder vertrek in de feed"
    )
    # Vertrekken in het rayon zonder CHB-perron: hoort klein te zijn, anders klopt de koppeling niet.
    binnen = los + sum(p["vertrekken"] for p in perrons)
    print(f"  vertrekken in het rayon zonder perron in het CHB: {los} van {binnen}")
    if los > 0.02 * binnen:
        raise ValueError(
            "meer dan 2% van de vertrekken vindt geen perron; koppeling nakijken"
        )
    for p in stil:
        print(f"    zonder vertrek: {p['halte']} ({p['modus']}, {p['code']})")
    for code in GEBIEDEN:
        t = tel([p for p in perrons if p["gebied"] == code])
        print(
            f"  {code}: {t['beide']}/{t['perrons']} perrons beide, "
            f"{100 * t['vertrekkenBeide'] / t['vertrekken']:.0f}% van de vertrekken"
        )

    uit = {
        "bron": "Centraal Haltebestand (CHB), open data via NDOV Loket (DOVA)",
        "export": chb.name.removeprefix("ExportCHB_").removesuffix(".xml.gz"),
        "gtfs": a.gtfs.name,
        "peildatum": ov["peildatum"],
        "koppelM": KOPPEL_M,
        "gebieden": {
            code: {
                **tel([p for p in perrons if p["gebied"] == code]),
                "buurten": {
                    b["naam"]: tel([p for p in perrons if p["buurt"] == b["naam"]])
                    for b in buurten
                    if b["gebied"] == code
                },
            }
            for code in GEBIEDEN
        },
        "perrons": perrons,
    }
    tekst_ = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_toegankelijkheid.py. Niet met de hand bewerken.\n"
        f"const TOEGANKELIJK = {tekst_};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(tekst_) / 1024:.0f} kB")


if __name__ == "__main__":
    main()
