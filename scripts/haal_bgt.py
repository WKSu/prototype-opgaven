# /// script
# requires-python = ">=3.11"
# dependencies = ["pyshp", "shapely>=2"]
# ///
"""Haalt een volledige BGT-uitsnede voor het rayon op bij PDOK (BGT Download API).

De handmatig aangeleverde uitsnede (data_manual/bgt_noord_buitenring) mist ongeveer de helft
van de vlakken; voor de noemer van het ruimtebeslag is een sluitende BGT nodig. Dit script
vraagt een custom extract aan voor de subbuurtdelen van het rayon (plus 25 m) en bewaart de zip.

    uv run scripts/haal_bgt.py

Openbare data van het Kadaster (CC-BY 4.0). Alleen de rayongrens gaat naar PDOK.
"""

import argparse
import json
import time
import urllib.request
from pathlib import Path

import shapefile
import shapely

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.pdok.nl/lv/bgt/download/v1_0/full/custom"
GEBIEDEN = {4, 6, 14}  # Overschie, Hillegersberg-Schiebroek, Prins Alexander
SOORTEN = [
    "wegdeel",
    "ondersteunendwegdeel",
    "begroeidterreindeel",
    "onbegroeidterreindeel",
    "waterdeel",
    "ondersteunendwaterdeel",
    "pand",
    "overbruggingsdeel",
]


def vraag(url: str, data: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--map", type=Path, default=ROOT / "data_manual/parkeerdruk/data")
    ap.add_argument(
        "--uit", type=Path, default=ROOT / "data_manual/bgt_pdok/extract.zip"
    )
    a = ap.parse_args()

    shp = shapefile.Reader(str(a.map / "Subbuurtdelen/Subbuurtdelen_vlakken.shp"))
    delen = [
        shapely.geometry.shape(v.__geo_interface__).buffer(0)
        for r, v in zip(shp.records(), shp.shapes())
        if r["GEBIED"] in GEBIEDEN
    ]
    # Eén buitengrens, vereenvoudigd: de API wil een korte WKT. De buffer vangt de afronding op.
    rayon = shapely.union_all(delen).buffer(25).simplify(20)
    rayon = shapely.Polygon(
        max(shapely.get_parts(rayon), key=lambda p: p.area).exterior
    )
    print(f"Rayongrens: {rayon.area / 1e4:.0f} ha, {len(rayon.exterior.coords)} punten")

    antw = vraag(
        API,
        {"featuretypes": SOORTEN, "format": "gmllight", "geofilter": rayon.wkt},
    )
    status_url = "https://api.pdok.nl" + antw["_links"]["status"]["href"]
    while True:
        st = vraag(status_url)
        print(f"  {st['status']} {st.get('progress', 0)}%")
        if st["status"] == "COMPLETED":
            break
        if st["status"] not in ("PENDING", "RUNNING"):
            raise RuntimeError(f"PDOK-extract mislukt: {st}")
        time.sleep(10)

    a.uit.parent.mkdir(parents=True, exist_ok=True)
    href = "https://api.pdok.nl" + st["_links"]["download"]["href"]
    urllib.request.urlretrieve(href, a.uit)
    (a.uit.parent / "geofilter.wkt").write_text(rayon.wkt, encoding="utf-8")
    print(f"{a.uit}: {a.uit.stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
