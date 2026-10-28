# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl", "pyproj", "pyshp", "shapely>=2"]
# ///
"""Bouwt data/woningbouw.js: woningbouwprojecten uit BoPro in het rayon, per subbuurt.

Leest data_manual/BoPro/BoPro_openbaar.gpkg (alleen OPENBAAR-projecten) en de subbuurtdelen.
Geen indicator: context voor parkeren. Elk project krijgt de subbuurt waarin zijn middelpunt
ligt, zodat de viewer het naast parkeerdruk, autobezit en OV kan leggen.

    uv run scripts/bouw_woningbouw.py
"""

import argparse
import json
import sqlite3
from pathlib import Path

import shapefile
import shapely
from bouw_parkeerdruk import GEBIEDEN, RD, ROOT, eis

# Fase van het project; de volgorde is die van zeker naar onzeker.
STATUS = {
    "OPGELEVERD": "opgeleverd",
    "GESTART": "in aanbouw",
    "HARDE_PLANVOORRAAD": "harde plancapaciteit",
    "ZACHTE_PLANVOORRAAD": "zachte plancapaciteit",
    "STUDIE": "studie",
}
SEGMENT = {
    "sociaal": [
        "woningcategorie_huur_sociaal_aantal",
        "woningcategorie_koop_sociaal_aantal",
    ],
    "midden": [
        "woningcategorie_huur_midden_aantal",
        "woningcategorie_koop_midden_aantal",
    ],
    "hoger": [
        "woningcategorie_huur_hoger_aantal",
        "woningcategorie_huur_top_aantal",
        "woningcategorie_koop_hoger_aantal",
        "woningcategorie_koop_top_aantal",
    ],
}


def gpkg_geometrie(blob: bytes) -> shapely.Geometry:
    # GeoPackage-blob: 'GP', versie, vlaggen, srs-id, envelop (lengte uit de vlaggen), dan WKB.
    if blob[:2] != b"GP":
        raise ValueError("geen GeoPackage-geometrie")
    envelop = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 0b111]
    return shapely.from_wkb(blob[8 + envelop :])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--gpkg", type=Path, default=ROOT / "data_manual/BoPro/BoPro_openbaar.gpkg"
    )
    ap.add_argument(
        "--sbd",
        type=Path,
        default=ROOT
        / "data_manual/parkeerdruk/data/Subbuurtdelen/Subbuurtdelen_vlakken.shp",
    )
    ap.add_argument("--uit", type=Path, default=ROOT / "data/woningbouw.js")
    a = ap.parse_args()

    sbd = shapefile.Reader(str(a.sbd))
    eis([f[0] for f in sbd.fields[1:]], "GEBIED", "TEKST", waar="Subbuurtdelen_vlakken")
    delen, codes = [], []
    for r, v in zip(sbd.records(), sbd.shapes()):
        if r["GEBIED"] in GEBIEDEN:
            g = shapely.geometry.shape(v.__geo_interface__)
            delen.append(g if g.is_valid else g.buffer(0))
            codes.append((r["TEKST"][:5], GEBIEDEN[r["GEBIED"]]))
    boom = shapely.STRtree(delen)

    con = sqlite3.connect(f"file:{a.gpkg}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    srs = con.execute(
        "select srs_id from gpkg_contents where table_name = 'WoningBouw'"
    ).fetchone()
    if not srs or srs[0] != 28992:
        raise ValueError(f"WoningBouw: verwacht RD New (28992), vond {srs and srs[0]}")
    rijen = con.execute("select * from WoningBouw").fetchall()
    eis(
        rijen[0].keys(),
        "geom",
        "naam",
        "status",
        "aantal_woningen",
        "jaar_oplevering",
        "vertrouwelijkheid",
        "buurtnaam",
        *[c for kol in SEGMENT.values() for c in kol],
        waar="WoningBouw",
    )

    projecten, onbekend = [], set()
    for r in rijen:
        if r["vertrouwelijkheid"] != "OPENBAAR" or not r["geom"]:
            continue
        punt = gpkg_geometrie(r["geom"]).point_on_surface()
        raak = [i for i in boom.query(punt, predicate="intersects")]
        if not raak:
            continue  # buiten het rayon
        if r["status"] not in STATUS:
            onbekend.add(r["status"])
            continue
        sub, gebied = codes[raak[0]]
        lon, lat = RD.transform(punt.x, punt.y)
        projecten.append(
            {
                "naam": r["naam"],
                "buurt": r["buurtnaam"],
                "subbuurt": sub,
                "gebied": gebied,
                "status": r["status"],
                "jaar": r["jaar_oplevering"],
                "woningen": r["aantal_woningen"] or 0,
                **{k: sum(r[c] or 0 for c in kol) for k, kol in SEGMENT.items()},
                "lon": round(lon, 5),
                "lat": round(lat, 5),
            }
        )
    if onbekend:
        raise ValueError(f"onbekende status in BoPro: {sorted(onbekend)}")

    uit = {
        "bron": "BoPro, woningbouwprognose gemeente Rotterdam, openbare projecten (handmatig aangeleverd)",
        "statussen": STATUS,
        "projecten": sorted(projecten, key=lambda p: (p["gebied"], -p["woningen"])),
    }
    tekst = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_woningbouw.py. Niet met de hand bewerken.\n"
        f"const WONINGBOUW = {tekst};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(tekst) / 1024:.0f} kB, {len(projecten)} projecten")
    for g in GEBIEDEN.values():
        ps = [p for p in projecten if p["gebied"] == g]
        per = {s: sum(p["woningen"] for p in ps if p["status"] == s) for s in STATUS}
        print(
            f"  {g}: {len(ps)} projecten, "
            + ", ".join(f"{STATUS[s]} {n}" for s, n in per.items())
        )


if __name__ == "__main__":
    main()
