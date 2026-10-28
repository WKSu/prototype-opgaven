# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "openpyxl", "pyproj", "pyshp", "shapely>=2"]
# ///
"""Bouwt data/ruimtebeslag.js: oppervlak parkeren ÷ openbare ruimte, per subbuurt(deel).

Leest de BGT-uitsnede van PDOK (data_manual/bgt_pdok/extract.zip, op te halen met
scripts/haal_bgt.py), de subbuurtdelen en de parkeertellingen (data_manual/parkeerdruk/data).

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
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapefile
import shapely
from bouw_parkeerdruk import GEBIEDEN, ROOT, eis, lees_telling, sbd_sleutel

# Groen dat aaneengesloten minstens zo groot is, telt als groot park en valt uit de noemer.
# Paden tot 2 × SLUIT_M breed sluiten we daarvoor dicht: een park met paden blijft één park.
GROOT_PARK_HA = 1
GEVOELIGHEID_HA = [0.5, 1, 2, 5]
SLUIT_M = 3
# Onder deze dekking is de BGT in het subbuurtdeel onvolledig: dan geen cijfer.
MIN_DEKKING = 0.95
BOOG_GRAAD = 10  # een gml:Arc wordt een lijn met een punt per 10 graden

NIET_OPENBAAR_FUNCTIE = {"rijbaan autosnelweg", "spoorbaan", "baan voor vliegverkeer"}
LANDBOUW = {"grasland agrarisch", "bouwland"}
GML = "{http://www.opengis.net/gml}"
IMGEO = "{http://www.geostandaarden.nl/imgeo/2.1/simple/gml31}"


def vlak(vorm) -> shapely.Geometry:
    # pyshp geeft __geo_interface__; buffer(0) repareert een enkele zelfdoorsnijding.
    g = shapely.geometry.shape(vorm.__geo_interface__)
    return g if g.is_valid else g.buffer(0)


def boog(p1, p2, p3) -> list:
    # Cirkel door drie punten, van p1 via p2 naar p3; recht als de punten op een lijn liggen.
    (ax, ay), (bx, by), (cx, cy) = p1, p2, p3
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return [p1, p3]
    a2, b2, c2 = ax**2 + ay**2, bx**2 + by**2, cx**2 + cy**2
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    h0, h2 = math.atan2(ay - uy, ax - ux), math.atan2(cy - uy, cx - ux)
    # Draairichting uit het kruisproduct: tegen de klok in als p2 links van p1→p3 ligt.
    tegen = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 0
    zwaai = (h2 - h0) % (2 * math.pi) if tegen else -((h0 - h2) % (2 * math.pi))
    n = max(2, math.ceil(abs(math.degrees(zwaai)) / BOOG_GRAAD))
    return [
        (ux + r * math.cos(h0 + zwaai * i / n), uy + r * math.sin(h0 + zwaai * i / n))
        for i in range(n + 1)
    ]


def punten(pos: str) -> list:
    v = [float(x) for x in pos.split()]
    return list(zip(v[0::2], v[1::2]))


def ring(el) -> list:
    # Een ring is een LinearRing met posList, of een Ring van Curve-segmenten (lijn en boog).
    uit = []
    for seg in el.iter():
        tag = seg.tag.removeprefix(GML)
        if tag in ("LineStringSegment", "LinearRing", "LineString"):
            pts = punten(seg.find(f"{GML}posList").text)
        elif tag in ("Arc", "ArcString"):
            p = punten(seg.find(f"{GML}posList").text)
            pts = [p[0]]
            for i in range(0, len(p) - 2, 2):
                pts += boog(p[i], p[i + 1], p[i + 2])[1:]
        else:
            continue
        uit += pts[1:] if uit and pts[0] == uit[-1] else pts
    return uit


def gml_vlak(el) -> shapely.Geometry | None:
    pols = []
    for pol in el.iter(f"{GML}Polygon"):
        buiten = ring(pol.find(f"{GML}exterior"))
        gaten = [ring(i) for i in pol.findall(f"{GML}interior")]
        if len(buiten) >= 4:
            pols.append(shapely.Polygon(buiten, [g for g in gaten if len(g) >= 4]))
    if not pols:
        return None
    g = pols[0] if len(pols) == 1 else shapely.MultiPolygon(pols)
    return g if g.is_valid else g.buffer(0)


def lees_bgt(zip_pad: Path):
    # Alleen de actuele versie (geen eindRegistratie), bestaand, op maaiveld.
    with zipfile.ZipFile(zip_pad) as zf:
        for naam in sorted(zf.namelist()):
            if not naam.endswith(".gml"):
                continue
            with zf.open(naam) as f:
                for _, el in ET.iterparse(f):
                    if el.tag != f"{GML}featureMember":
                        continue
                    obj = el[0]
                    veld = {
                        c.tag.removeprefix(IMGEO): (c.text or "").strip() for c in obj
                    }
                    if (
                        not veld.get("eindRegistratie")
                        and veld.get("bgt-status") == "bestaand"
                        and veld.get("relatieveHoogteligging") == "0"
                    ):
                        g = gml_vlak(obj)
                        if g is not None and not g.is_empty:
                            yield obj.tag.removeprefix(IMGEO), veld, g
                    el.clear()


def soort(type_: str, veld: dict) -> str | None:
    # 'parkeer', 'groen' en 'overig' zijn openbaar; None is geen openbare ruimte.
    functie = veld.get("bgt-functie", "")
    fysiek = veld.get("bgt-fysiekVoorkomen", "")
    plus = veld.get("plus-fysiekVoorkomen", "")
    if type_ == "Wegdeel":
        if functie in NIET_OPENBAAR_FUNCTIE:
            return None
        return "parkeer" if functie == "parkeervlak" else "overig"
    if type_ == "OndersteunendWegdeel":
        return "overig"
    if type_ == "BegroeidTerreindeel":
        return None if fysiek in LANDBOUW else "groen"
    if type_ == "OnbegroeidTerreindeel":
        if fysiek == "erf":
            return None
        return "groen" if "kunstgras" in plus.lower() else "overig"
    return None  # pand, water, overbrugging: wel voor de dekking, niet openbaar


def per_deel(delen, geoms, boom) -> np.ndarray:
    # Oppervlak van elk vlak binnen elk subbuurtdeel, als matrix [deel, vlak] in paren.
    i_vlak, i_deel = boom.query(geoms, predicate="intersects")
    opp = shapely.area(shapely.intersection(geoms[i_vlak], delen[i_deel]))
    return i_vlak, i_deel, opp


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--bgt", type=Path, default=ROOT / "data_manual/bgt_pdok/extract.zip"
    )
    ap.add_argument("--map", type=Path, default=ROOT / "data_manual/parkeerdruk/data")
    ap.add_argument("--uit", type=Path, default=ROOT / "data/ruimtebeslag.js")
    a = ap.parse_args()

    sbd_shp = shapefile.Reader(str(a.map / "Subbuurtdelen/Subbuurtdelen_vlakken.shp"))
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

    alle, soorten, typen = [], [], defaultdict(int)
    for type_, veld, g in lees_bgt(a.bgt):
        alle.append(g)
        soorten.append(soort(type_, veld))
        typen[type_] += 1
    if not alle:
        raise ValueError(f"{a.bgt}: geen BGT-vlakken gelezen")
    alle = np.array(alle)
    soorten = np.array(soorten, dtype=object)
    print(f"BGT: {len(alle)} actuele vlakken op maaiveld: {dict(typen)}")

    n = len(delen)
    dekking = np.zeros(n)
    opp = {s: np.zeros(n) for s in ("parkeer", "groen", "overig")}
    i_vlak, i_deel, o = per_deel(delen, alle, boom)
    np.add.at(dekking, i_deel, o)
    for s, som_s in opp.items():
        m = soorten[i_vlak] == s
        np.add.at(som_s, i_deel[m], o[m])
    dekking /= shapely.area(delen)

    # Grote parken: groen sluiten over smalle paden, opdelen in aaneengesloten stukken.
    groen = shapely.union_all(alle[soorten == "groen"]).buffer(SLUIT_M).buffer(-SLUIT_M)
    stukken = np.array(
        [g for g in shapely.get_parts(groen) if g.area >= min(GEVOELIGHEID_HA) * 1e4]
    )
    print(f"Groen: {len(stukken)} aaneengesloten stukken >= {min(GEVOELIGHEID_HA)} ha")
    # Openbare ruimte binnen elk groot stuk, per subbuurtdeel. Ook paden en parkeervlakken die
    # het sluiten opslokt, vallen dan uit de noemer; parkeervlak meten we apart.
    is_openbaar = np.array([s is not None for s in soorten])
    openbaar, o_soort = alle[is_openbaar], soorten[is_openbaar]
    in_park = {ha: np.zeros(n) for ha in GEVOELIGHEID_HA}
    parkeer_in_park = np.zeros(n)
    sboom = shapely.STRtree(stukken)
    i_o, i_s = sboom.query(openbaar, predicate="intersects")
    stuk_deel = shapely.intersection(openbaar[i_o], stukken[i_s])
    j_o, j_d = boom.query(stuk_deel, predicate="intersects")
    o2 = shapely.area(shapely.intersection(stuk_deel[j_o], delen[j_d]))
    stuk_ha = shapely.area(stukken)[i_s[j_o]] / 1e4
    for ha in GEVOELIGHEID_HA:
        m = stuk_ha >= ha
        np.add.at(in_park[ha], j_d[m], o2[m])
    m = (o_soort[i_o[j_o]] == "parkeer") & (stuk_ha >= GROOT_PARK_HA)
    np.add.at(parkeer_in_park, j_d[m], o2[m])
    print(f"Parkeervlak binnen grote parken: {parkeer_in_park.sum():.0f} m2, valt weg")

    totaal = opp["parkeer"] + opp["groen"] + opp["overig"]
    bgt_parkeer = opp["parkeer"] - parkeer_in_park

    # Ijking: m² BGT-parkeervlak per getelde plek, over getelde delen met volledige BGT.
    ijk = [i for i in cap if cap[i] > 0 and dekking[i] >= MIN_DEKKING]
    m2_plek = sum(bgt_parkeer[i] for i in ijk) / sum(cap[i] for i in ijk)
    verh = np.array([bgt_parkeer[i] / cap[i] for i in ijk])
    print(
        f"Ijking op {len(ijk)} getelde delen: {m2_plek:.1f} m2 BGT-parkeervlak per plek"
        f" (mediaan {np.median(verh):.1f}, p25 {np.percentile(verh, 25):.1f},"
        f" p75 {np.percentile(verh, 75):.1f})"
    )

    def deel(i: int) -> dict:
        r = recs[i]
        vol = dekking[i] >= MIN_DEKKING
        if i in cap:
            bron, plek, park_m2 = "telling", cap[i], cap[i] * m2_plek
        elif vol:
            bron, plek, park_m2 = "bgt", bgt_parkeer[i] / m2_plek, bgt_parkeer[i]
        else:
            bron, plek, park_m2 = None, None, None
        return {
            "code": r["TEKST"],
            "subbuurt": r["TEKST"][:5],
            "buurt": r["BUURTNAAM"],
            "gebied": GEBIEDEN[r["GEBIED"]],
            "dekking": round(float(dekking[i]), 3),
            "bron": bron,
            "plekken": round(float(plek)) if plek is not None else None,
            "parkeren": round(float(park_m2)) if park_m2 is not None else None,
            "bgtParkeren": round(float(bgt_parkeer[i])) if vol else None,
            "openbaar": round(float(totaal[i] - in_park[GROOT_PARK_HA][i]))
            if vol
            else None,
            "inPark": {str(ha): round(float(in_park[ha][i])) for ha in GEVOELIGHEID_HA}
            if vol
            else None,
            "openbaarBruto": round(float(totaal[i])) if vol else None,
        }

    uit_delen = sorted((deel(i) for i in range(n)), key=lambda d: d["code"])

    # Subbuurt = som van de delen; alleen een cijfer als elk deel teller en noemer heeft.
    groep = defaultdict(list)
    for d in uit_delen:
        groep[d["subbuurt"]].append(d)
    subbuurten = []
    for code, ds in sorted(groep.items()):
        heel = all(d["openbaar"] is not None and d["parkeren"] is not None for d in ds)
        bronnen = {d["bron"] for d in ds}
        som = {
            k: sum(d[k] for d in ds) if heel else None
            for k in ("plekken", "parkeren", "openbaar", "openbaarBruto")
        }
        ob, pk = som["openbaar"], som["parkeren"]
        subbuurten.append(
            {
                "code": code,
                "buurt": ds[0]["buurt"],
                "gebied": ds[0]["gebied"],
                "delen": len(ds),
                # telling of bgt als alle delen uit dezelfde bron komen, anders mix
                "bron": (bronnen.pop() if len(bronnen) == 1 else "mix")
                if heel
                else None,
                "plekken": som["plekken"],
                "parkeren": pk,
                "openbaar": ob,
                "openbaarBruto": som["openbaarBruto"],
                "inPark": {
                    str(ha): sum(d["inPark"][str(ha)] for d in ds)
                    for ha in GEVOELIGHEID_HA
                }
                if heel
                else None,
                "aandeel": round(100 * pk / ob, 1) if heel and ob else None,
            }
        )

    uit = {
        "bron": "BGT, actuele stand via de PDOK BGT Download API; capaciteit uit de parkeertellingen (handmatig aangeleverd)",
        "regel": "ruimtebeslag = oppervlak parkeren ÷ openbare ruimte zonder grote parken",
        "teller": f"getelde plekken (algemeen + bijzonder) × {m2_plek:.1f} m²; zonder telling het oppervlak van de BGT-parkeervlakken",
        "noemer": "BGT, Topo-laag op maaiveld: wegdelen, bermen, groen en openbare verharding; zonder gebouwen, erven, water, landbouwgrond, snelweg, spoor en landingsbaan",
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
        "minDekking": MIN_DEKKING,
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
            f" {sum(d['bron'] == 'bgt' for d in ds)} uit BGT, {sum(d['bron'] is None for d in ds)} zonder"
        )


if __name__ == "__main__":
    main()
