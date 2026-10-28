# /// script
# requires-python = ">=3.11"
# dependencies = ["lxml", "numpy", "openpyxl", "pyproj", "pyshp", "shapely>=2"]
# ///
"""Bouwt data/ruimtebeslag.js: oppervlak parkeren ÷ openbare ruimte, per subbuurt(deel).

Leest de BGT-tegels van PDOK (data_manual/bgt_pdok/tegels, op te halen met scripts/haal_bgt.py),
de subbuurtdelen en de parkeertellingen (data_manual/parkeerdruk/data).

    uv run scripts/bouw_ruimtebeslag.py

Teller: de structurele capaciteit uit de tellingen (algemeen + bijzonder) maal een oppervlak
per plek. Waar geen telling is, het oppervlak van de BGT-parkeervlakken. Het oppervlak per plek
is geijkt op de getelde subbuurtdelen: BGT-parkeervlak ÷ getelde plekken, zodat beide bronnen
op dezelfde schaal staan. Noemer: openbare ruimte uit de BGT, zonder water, gebouwen, erven,
landbouwgrond, snelweg, spoor en landingsbaan, en zonder grote parken.

De handmatig aangeleverde shapefile (data_manual/bgt_noord_buitenring) gebruiken we niet: daar
ontbreekt ongeveer de helft van de vlakken (steekproef subbuurtdeel 045100: 3,4 van 8,2 ha
bedekt, tegen 8,2 ha in de PDOK-BGT), dus de noemer zou te klein uitvallen.

shapely: overlap van ruim 100.000 BGT-vlakken met subbuurtdelen; met de hand niet te doen.
"""

import argparse
import base64
import gzip
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapefile
import shapely
from bouw_parkeerdruk import GEBIEDEN, ROOT, eis, lees_telling, sbd_sleutel
from haal_bgt import rayon, tegels

# Groen dat aaneengesloten minstens zo groot is, telt als groot park en valt uit de noemer.
# Paden tot 2 × SLUIT_M breed sluiten we daarvoor dicht: een park met paden blijft één park.
GROOT_PARK_HA = 1
GEVOELIGHEID_HA = [0.5, 1, 2, 5]
SLUIT_M = 3

NIET_OPENBAAR_FUNCTIE = {"rijbaan autosnelweg", "spoorbaan", "baan voor vliegverkeer"}
LANDBOUW = {"grasland agrarisch", "bouwland"}


def vlak(vorm) -> shapely.Geometry:
    # pyshp geeft __geo_interface__; buffer(0) repareert een enkele zelfdoorsnijding.
    g = shapely.geometry.shape(vorm.__geo_interface__)
    return g if g.is_valid else g.buffer(0)


def soort(r: dict) -> str | None:
    # 'parkeer', 'groen' en 'overig' zijn openbaar; None is geen openbare ruimte.
    if r["t"] == "Wegdeel":
        if r["f"] in NIET_OPENBAAR_FUNCTIE:
            return None
        return "parkeer" if r["f"] == "parkeervlak" else "overig"
    if r["t"] == "OndersteunendWegdeel":
        return "overig"
    if r["t"] == "BegroeidTerreindeel":
        return None if r["v"] in LANDBOUW else "groen"
    if r["t"] == "OnbegroeidTerreindeel":
        if r["v"] == "erf":
            return None
        return "groen" if "kunstgras" in r["p"].lower() else "overig"
    raise ValueError(f"onbekend BGT-type {r['t']}")


def lees_tegels(map_: Path, verwacht: set[str]):
    # Een object op een tegelgrens staat in beide tegels: één keer tellen, op lokaalID.
    ontbreekt = sorted(k for k in verwacht if not (map_ / f"{k}.jsonl.gz").exists())
    if ontbreekt:
        raise FileNotFoundError(
            f"{len(ontbreekt)} BGT-tegels ontbreken ({', '.join(ontbreekt[:5])}...); draai scripts/haal_bgt.py"
        )
    gezien = set()
    for k in sorted(verwacht):
        with gzip.open(map_ / f"{k}.jsonl.gz", "rt", encoding="utf-8") as f:
            for regel in f:
                r = json.loads(regel)
                if r["id"] not in gezien:
                    gezien.add(r["id"])
                    yield r


def per_deel(delen, geoms, boom):
    # Oppervlak van elk vlak binnen elk subbuurtdeel, als paren (vlak, deel, oppervlak).
    i_vlak, i_deel = boom.query(geoms, predicate="intersects")
    opp = shapely.area(shapely.intersection(geoms[i_vlak], delen[i_deel]))
    return i_vlak, i_deel, opp


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bgt", type=Path, default=ROOT / "data_manual/bgt_pdok/tegels")
    ap.add_argument("--map", type=Path, default=ROOT / "data_manual/parkeerdruk/data")
    ap.add_argument("--uit", type=Path, default=ROOT / "data/ruimtebeslag.js")
    a = ap.parse_args()

    sbd_pad = a.map / "Subbuurtdelen/Subbuurtdelen_vlakken.shp"
    sbd_shp = shapefile.Reader(str(sbd_pad))
    eis(
        [f[0] for f in sbd_shp.fields[1:]],
        "GEBIED",
        "BUURT",
        "SUBBUURT",
        "SBTDEEL",
        "TEKST",
        "BUURTNAAM",
        waar="Subbuurtdelen_vlakken",
    )
    recs, delen = [], []
    for rec, vorm in zip(sbd_shp.records(), sbd_shp.shapes()):
        if rec["GEBIED"] in GEBIEDEN:
            recs.append(rec)
            delen.append(vlak(vorm))
    delen = np.array(delen)
    boom = shapely.STRtree(delen)
    sleutel = {(r["BUURT"], r["SUBBUURT"], r["SBTDEEL"]): i for i, r in enumerate(recs)}

    # Structurele capaciteit per subbuurtdeel: algemeen + bijzonder, de hoogste over de metingen
    # (een meting kan plekken missen door werk in de straat; het profiel verandert niet).
    cap = {}
    for z in sorted(a.map.glob("*.zip")):
        t = lees_telling(z)
        eis(t["rijen"][0], "Capaciteit Algemeen", "Capaciteit Bijzonder", waar=z.name)
        for r in t["rijen"]:
            i = sleutel.get(sbd_sleutel(r["Subbuurtdeel"]))
            if i is None:
                continue
            c = (r["Capaciteit Algemeen"] or 0) + (r["Capaciteit Bijzonder"] or 0)
            cap[i] = max(cap.get(i, 0), c)

    # Alleen de openbare soorten bewaren; erf en landbouwgrond vallen hier al af.
    alle, soorten, typen = [], [], defaultdict(int)
    for r in lees_tegels(a.bgt, set(tegels(rayon(sbd_pad)))):
        typen[r["t"]] += 1
        s = soort(r)
        if s:
            alle.append(shapely.from_wkb(base64.b64decode(r["g"])))
            soorten.append(s)
    alle = np.array(alle)
    soorten = np.array(soorten)
    print(f"BGT: {len(alle)} openbare vlakken, uit {dict(typen)}")

    n = len(delen)
    opp = {s: np.zeros(n) for s in ("parkeer", "groen", "overig")}
    i_vlak, i_deel, o = per_deel(delen, alle, boom)
    for s, som_s in opp.items():
        m = soorten[i_vlak] == s
        np.add.at(som_s, i_deel[m], o[m])

    # Grote parken: groen sluiten over smalle paden, opdelen in aaneengesloten stukken.
    groen = shapely.union_all(alle[soorten == "groen"]).buffer(SLUIT_M).buffer(-SLUIT_M)
    stukken = np.array(
        [g for g in shapely.get_parts(groen) if g.area >= min(GEVOELIGHEID_HA) * 1e4]
    )
    print(f"Groen: {len(stukken)} aaneengesloten stukken >= {min(GEVOELIGHEID_HA)} ha")
    # Openbare ruimte binnen elk groot stuk, per subbuurtdeel. Ook paden en parkeervlakken die
    # het sluiten opslokt, vallen dan uit de noemer; parkeervlak meten we apart.
    in_park = {ha: np.zeros(n) for ha in GEVOELIGHEID_HA}
    parkeer_in_park = np.zeros(n)
    i_o, i_s = shapely.STRtree(stukken).query(alle, predicate="intersects")
    stuk_deel = shapely.intersection(alle[i_o], stukken[i_s])
    j_o, j_d = boom.query(stuk_deel, predicate="intersects")
    o2 = shapely.area(shapely.intersection(stuk_deel[j_o], delen[j_d]))
    stuk_ha = shapely.area(stukken)[i_s[j_o]] / 1e4
    for ha in GEVOELIGHEID_HA:
        m = stuk_ha >= ha
        np.add.at(in_park[ha], j_d[m], o2[m])
    m = (soorten[i_o[j_o]] == "parkeer") & (stuk_ha >= GROOT_PARK_HA)
    np.add.at(parkeer_in_park, j_d[m], o2[m])
    print(f"Parkeervlak binnen grote parken: {parkeer_in_park.sum():.0f} m2, valt weg")

    totaal = opp["parkeer"] + opp["groen"] + opp["overig"]
    bgt_parkeer = opp["parkeer"] - parkeer_in_park
    for code, g in GEBIEDEN.items():
        ix = [i for i, r in enumerate(recs) if r["GEBIED"] == code]
        print(
            f"  {g}: openbare ruimte {totaal[ix].sum() / 1e4:.0f} ha van"
            f" {shapely.area(delen[ix]).sum() / 1e4:.0f} ha"
        )

    # IJking: m² BGT-parkeervlak per getelde plek, over de getelde delen met plekken.
    ijk = [i for i in cap if cap[i] > 0]
    m2_plek = sum(bgt_parkeer[i] for i in ijk) / sum(cap[i] for i in ijk)
    verh = np.array([bgt_parkeer[i] / cap[i] for i in ijk])
    print(
        f"IJking op {len(ijk)} getelde delen: {m2_plek:.1f} m2 BGT-parkeervlak per plek"
        f" (mediaan {np.median(verh):.1f}, p25 {np.percentile(verh, 25):.1f},"
        f" p75 {np.percentile(verh, 75):.1f})"
    )

    def deel(i: int) -> dict:
        r = recs[i]
        if i in cap:
            bron, plek, park_m2 = "telling", cap[i], cap[i] * m2_plek
        else:
            bron, plek, park_m2 = "bgt", bgt_parkeer[i] / m2_plek, bgt_parkeer[i]
        return {
            "code": r["TEKST"],
            "subbuurt": r["TEKST"][:5],
            "buurt": r["BUURTNAAM"],
            "gebied": GEBIEDEN[r["GEBIED"]],
            "bron": bron,
            "plekken": round(float(plek)),
            "parkeren": round(float(park_m2)),
            "bgtParkeren": round(float(bgt_parkeer[i])),
            "openbaar": round(float(totaal[i] - in_park[GROOT_PARK_HA][i])),
            "inPark": {str(ha): round(float(in_park[ha][i])) for ha in GEVOELIGHEID_HA},
            "openbaarBruto": round(float(totaal[i])),
        }

    uit_delen = sorted((deel(i) for i in range(n)), key=lambda d: d["code"])

    # Subbuurt = som van de delen.
    groep = defaultdict(list)
    for d in uit_delen:
        groep[d["subbuurt"]].append(d)
    subbuurten = []
    for code, ds in sorted(groep.items()):
        bronnen = {d["bron"] for d in ds}
        som = {
            k: sum(d[k] for d in ds)
            for k in ("plekken", "parkeren", "openbaar", "openbaarBruto")
        }
        subbuurten.append(
            {
                "code": code,
                "buurt": ds[0]["buurt"],
                "gebied": ds[0]["gebied"],
                "delen": len(ds),
                # telling of bgt als alle delen uit dezelfde bron komen, anders mix
                "bron": bronnen.pop() if len(bronnen) == 1 else "mix",
                **som,
                "inPark": {
                    str(ha): sum(d["inPark"][str(ha)] for d in ds)
                    for ha in GEVOELIGHEID_HA
                },
                "aandeel": round(100 * som["parkeren"] / som["openbaar"], 1)
                if som["openbaar"]
                else None,
            }
        )

    uit = {
        "bron": "BGT, actuele stand via de PDOK BGT Download API; capaciteit uit de parkeertellingen (handmatig aangeleverd)",
        "regel": "ruimtebeslag = oppervlak parkeren ÷ openbare ruimte zonder grote parken",
        "teller": f"getelde plekken (algemeen + bijzonder) × {f'{m2_plek:.1f}'.replace('.', ',')} m²; zonder telling het oppervlak van de BGT-parkeervlakken",
        "noemer": "BGT op maaiveld: wegdelen, bermen, groen en openbare verharding; zonder gebouwen, erven, water, landbouwgrond, snelweg, spoor en landingsbaan",
        "m2PerPlek": round(m2_plek, 1),
        "ijking": {
            "delen": len(ijk),
            "mediaan": round(float(np.median(verh)), 1),
            "p25": round(float(np.percentile(verh, 25)), 1),
            "p75": round(float(np.percentile(verh, 75)), 1),
        },
        "grootPark": {
            "ha": GROOT_PARK_HA,
            "sluitM": 2 * SLUIT_M,
            "gevoeligheid": GEVOELIGHEID_HA,
        },
        "subbuurtdelen": uit_delen,
        "subbuurten": subbuurten,
    }
    tekst = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_ruimtebeslag.py. Niet met de hand bewerken.\n"
        f"const RUIMTEBESLAG = {tekst};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(tekst) / 1024:.0f} kB")
    for g in GEBIEDEN.values():
        ds = [d for d in uit_delen if d["gebied"] == g]
        print(
            f"  {g}: {sum(d['bron'] == 'telling' for d in ds)} delen uit telling,"
            f" {sum(d['bron'] == 'bgt' for d in ds)} uit BGT"
        )


if __name__ == "__main__":
    main()
