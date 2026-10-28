# /// script
# requires-python = ">=3.11"
# dependencies = ["lxml", "pyproj", "pyshp", "shapely>=2"]
# ///
"""Haalt de P+R-terreinen in en rond het rayon uit het Nationaal Parkeerregister (NPR, RDW).

Open data, geen sleutel: https://npropendata.rdw.nl/parkingdata/v2/. Per terrein de recentste
specificatie (capaciteit, laadpunten) en de locatie van de toegang. Schrijft data/pr.js.

    uv run scripts/haal_npr.py

Een NPR-record heeft een geldigheidsperiode; een record waarvan die is verlopen, nemen we op met
`verlopen: true`, want het terrein kan er nog liggen terwijl de registratie niet is bijgewerkt.
Dubbele registraties (zelfde naam) voegen we samen tot het record met de recentste specificatie.
"""

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

import shapely
from haal_bgt import rayon
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
INDEX = "https://npropendata.rdw.nl/parkingdata/v2/"
# Plaatsnamen rond het rayon; P+R's verderop vangen geen verkeer uit dit rayon op.
REGIO = r"Rotterdam|Capelle aan den IJssel|Lansingerland|Schiedam"
PR_NAAM = r"P\s?\+\s?R|P\s?&\s?R|Park\s?(and|&|\+)\s?Ride|transferium"
STRAAL_M = (
    1000  # binnen deze afstand van het rayon telt een P+R mee; verder weg (Schiedam,
)
# Centraal) vangt het verkeer uit dit rayon niet op
NU = time.time()
WGS_RD = Transformer.from_crs(4326, 28992, always_xy=True)


def haal(url: str):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def laatste(items: list) -> dict | None:
    # Het item met de recentste begindatum van zijn geldigheid.
    items = [i for i in items or [] if i]
    return max(items, key=lambda i: i.get("validityStartOfPeriod") or 0, default=None)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--sbd",
        type=Path,
        default=ROOT
        / "data_manual/parkeerdruk/data/Subbuurtdelen/Subbuurtdelen_vlakken.shp",
    )
    ap.add_argument("--uit", type=Path, default=ROOT / "data/pr.js")
    a = ap.parse_args()

    gebied = rayon(a.sbd)
    index = haal(INDEX)["ParkingFacilities"]
    # Op naam voorselecteren: de index heeft geen locatie, en 15.000 records ophalen is te veel.
    kandidaten = [f for f in index if re.search(REGIO, f.get("name") or "")]
    print(f"NPR: {len(index)} terreinen, {len(kandidaten)} in de regio")

    terreinen = {}
    for f in kandidaten:
        info = haal(f["staticDataUrl"])["parkingFacilityInformation"]
        spec = laatste(info.get("specifications"))
        is_pr = (spec and spec.get("usage") == "P+R") or re.search(
            PR_NAAM, info["name"], re.IGNORECASE
        )
        punten = [
            laatste(ap_.get("accessPointLocation"))
            for ap_ in info.get("accessPoints") or []
        ]
        punten = [p for p in punten if p and p.get("latitude")]
        if not is_pr or not spec or not punten:
            continue
        lon, lat = punten[0]["longitude"], punten[0]["latitude"]
        afstand = shapely.Point(WGS_RD.transform(lon, lat)).distance(gebied)
        if afstand > STRAAL_M:
            continue
        eind = info.get("validityEndOfPeriod")
        rec = {
            "naam": re.sub(r"\s*\([^)]*\)$", "", info["name"]).strip(),
            "plaats": (re.search(r"\(([^)]*)\)$", info["name"]) or [None, ""])[1],
            "npr": info["identifier"],
            "capaciteit": spec.get("capacity"),
            "laadpunten": spec.get("chargingPointCapacity"),
            "specificatieVanaf": time.strftime(
                "%Y-%m-%d", time.gmtime(spec["validityStartOfPeriod"])
            ),
            "verlopen": bool(eind and eind < NU),
            "inRayon": afstand == 0,
            "afstandM": round(afstand),
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "_start": spec["validityStartOfPeriod"],
        }
        # Dubbele registratie onder dezelfde naam: houd de recentste specificatie.
        oud = terreinen.get(rec["naam"])
        if not oud or (oud["verlopen"], -oud["_start"]) > (
            rec["verlopen"],
            -rec["_start"],
        ):
            terreinen[rec["naam"]] = rec

    uit = sorted(
        terreinen.values(), key=lambda r: (not r["inRayon"], r["afstandM"], r["naam"])
    )
    for r in uit:
        del r["_start"]
    data = {
        "bron": "Nationaal Parkeerregister (RDW), open data via npropendata.rdw.nl",
        "opgehaald": time.strftime("%Y-%m-%d"),
        "straalM": STRAAL_M,
        "terreinen": uit,
    }
    tekst = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/haal_npr.py. Niet met de hand bewerken.\n"
        f"const PR = {tekst};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(uit)} P+R-terreinen binnen {STRAAL_M} m van het rayon")
    for r in uit:
        print(
            f"  {r['naam']} ({r['plaats']}): {r['capaciteit']} plekken, {r['laadpunten']} laadpunten,"
            f" {'in rayon' if r['inRayon'] else str(r['afstandM']) + ' m'}"
            f"{', registratie verlopen' if r['verlopen'] else ''}, spec {r['specificatieVanaf']}"
        )


if __name__ == "__main__":
    main()
