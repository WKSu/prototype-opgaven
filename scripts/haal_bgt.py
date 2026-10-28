# /// script
# requires-python = ">=3.11"
# dependencies = ["lxml", "pyshp", "shapely>=2"]
# ///
"""Haalt de BGT voor het rayon op bij PDOK (BGT Download API), in tegels van 1 km².

De handmatig aangeleverde uitsnede (data_manual/bgt_noord_buitenring) mist ongeveer de helft
van de vlakken; voor de noemer van het ruimtebeslag is een sluitende BGT nodig.

    uv run scripts/haal_bgt.py

Per tegel: extract aanvragen, downloaden, alleen de actuele objecten op maaiveld bewaren
(PDOK levert ook de historie mee, ongeveer de helft van het volume) en de GML weggooien. Wat
overblijft staat per tegel in data_manual/bgt_pdok/tegels/X_Y.jsonl.gz. Een tegel die er al is,
wordt overgeslagen: afgebroken is hervatten. Alleen de objecttypen die de berekening gebruikt.

Openbare data van het Kadaster (CC-BY 4.0). Alleen de tegelgrenzen gaan naar PDOK.
lxml: de GML is ~300 MB per km²; ElementTree is daar te traag voor.
"""

import argparse
import base64
import gzip
import io
import json
import math
import time
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import shapefile
import shapely
from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.pdok.nl/lv/bgt/download/v1_0/full/custom"
GEBIEDEN = {4, 6, 14}  # Overschie, Hillegersberg-Schiebroek, Prins Alexander
SOORTEN = [
    "wegdeel",
    "ondersteunendwegdeel",
    "begroeidterreindeel",
    "onbegroeidterreindeel",
]
TEGEL_M = 1000
PARALLEL = 4
BOOG_GRAAD = 10  # een gml:Arc wordt een lijn met een punt per 10 graden
GML = "{http://www.opengis.net/gml}"
IMGEO = "{http://www.geostandaarden.nl/imgeo/2.1/simple/gml31}"
VELDEN = {
    "identificatie.lokaalID": "id",
    "eindRegistratie": "eind",
    "bgt-status": "status",
    "relatieveHoogteligging": "hoogte",
    "bgt-functie": "f",
    "bgt-fysiekVoorkomen": "v",
    "plus-fysiekVoorkomen": "p",
}


def rayon(sbd: Path) -> shapely.Polygon:
    shp = shapefile.Reader(str(sbd))
    delen = [
        shapely.geometry.shape(v.__geo_interface__).buffer(0)
        for r, v in zip(shp.records(), shp.shapes())
        if r["GEBIED"] in GEBIEDEN
    ]
    u = shapely.union_all(delen).buffer(25).simplify(20)
    return shapely.Polygon(max(shapely.get_parts(u), key=lambda p: p.area).exterior)


def tegels(gebied: shapely.Polygon) -> dict[str, shapely.Polygon]:
    # Raster op hele kilometers; per tegel het stuk dat in het rayon valt.
    x0, y0, x1, y1 = gebied.bounds
    uit = {}
    for x in range(int(x0 // TEGEL_M), math.ceil(x1 / TEGEL_M)):
        for y in range(int(y0 // TEGEL_M), math.ceil(y1 / TEGEL_M)):
            vak = shapely.box(
                x * TEGEL_M, y * TEGEL_M, (x + 1) * TEGEL_M, (y + 1) * TEGEL_M
            )
            stuk = vak.intersection(gebied)
            if stuk.area > 1:
                # De API wil één polygoon; een tegel die in stukken valt, vragen we heel aan.
                uit[f"{x}_{y}"] = (
                    stuk.simplify(1) if stuk.geom_type == "Polygon" else vak
                )
    return uit


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
        tag = seg.tag.removeprefix(GML) if isinstance(seg.tag, str) else ""
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


def vraag(url: str, data: dict | None = None):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r) if data is not None or url.endswith("/status") else r.read()


def haal_tegel(naam: str, filter_wkt: str, uit: Path) -> tuple[str, int, int, float]:
    t0 = time.time()
    antw = vraag(
        API, {"featuretypes": SOORTEN, "format": "gmllight", "geofilter": filter_wkt}
    )
    status_url = "https://api.pdok.nl" + antw["_links"]["status"]["href"]
    while True:
        st = vraag(status_url)
        if st["status"] == "COMPLETED":
            break
        if st["status"] not in ("PENDING", "RUNNING"):
            raise RuntimeError(f"tegel {naam}: PDOK meldt {st}")
        time.sleep(3)
    zip_bytes = vraag("https://api.pdok.nl" + st["_links"]["download"]["href"])

    vak = shapely.from_wkt(filter_wkt)
    rijen, gelezen = [], 0
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for gml in zf.namelist():
            with zf.open(gml) as f:
                for _, el in etree.iterparse(f, tag=f"{GML}featureMember"):
                    gelezen += 1
                    obj = el[0]
                    veld = {}
                    for c in obj:
                        k = VELDEN.get(etree.QName(c).localname)
                        if k:
                            veld[k] = (c.text or "").strip()
                    if (
                        not veld.get("eind")
                        and veld.get("status") == "bestaand"
                        and veld.get("hoogte") == "0"
                    ):
                        g = gml_vlak(obj)
                        if g is not None and not g.is_empty and g.intersects(vak):
                            rijen.append(
                                {
                                    "id": veld["id"],
                                    "t": etree.QName(obj).localname,
                                    "f": veld.get("f", ""),
                                    "v": veld.get("v", ""),
                                    "p": veld.get("p", ""),
                                    "g": base64.b64encode(shapely.to_wkb(g)).decode(),
                                }
                            )
                    el.clear()
                    while el.getprevious() is not None:
                        del el.getparent()[0]
    tmp = uit.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for r in rijen:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")
    tmp.replace(
        uit
    )  # pas bij een complete tegel: zo telt een afgebroken tegel als ontbrekend
    return naam, len(rijen), gelezen, time.time() - t0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--sbd",
        type=Path,
        default=ROOT
        / "data_manual/parkeerdruk/data/Subbuurtdelen/Subbuurtdelen_vlakken.shp",
    )
    ap.add_argument("--uit", type=Path, default=ROOT / "data_manual/bgt_pdok/tegels")
    a = ap.parse_args()
    a.uit.mkdir(parents=True, exist_ok=True)

    alle = tegels(rayon(a.sbd))
    nog = {k: v for k, v in alle.items() if not (a.uit / f"{k}.jsonl.gz").exists()}
    print(
        f"{len(alle)} tegels, {len(alle) - len(nog)} al binnen, {len(nog)} te halen",
        flush=True,
    )
    t0, klaar, fout = time.time(), 0, []
    with ProcessPoolExecutor(PARALLEL) as pool:
        taken = {
            pool.submit(haal_tegel, k, v.wkt, a.uit / f"{k}.jsonl.gz"): k
            for k, v in nog.items()
        }
        for t in as_completed(taken):
            klaar += 1
            try:
                naam, n, gelezen, sec = t.result()
                rest = (time.time() - t0) / klaar * (len(nog) - klaar)
                print(
                    f"  [{klaar}/{len(nog)}] {naam}: {n} actueel van {gelezen} ({sec:.0f} s), nog ~{rest / 60:.0f} min",
                    flush=True,
                )
            except (OSError, RuntimeError, ValueError, KeyError) as e:
                fout.append(taken[t])
                print(f"  [{klaar}/{len(nog)}] {taken[t]} MISLUKT: {e}", flush=True)
    mb = sum(p.stat().st_size for p in a.uit.glob("*.jsonl.gz")) / 1e6
    print(f"Klaar in {(time.time() - t0) / 60:.0f} min; {mb:.0f} MB in {a.uit}")
    if fout:
        raise SystemExit(
            f"{len(fout)} tegels mislukt ({', '.join(sorted(fout))}); draai opnieuw om ze te halen"
        )


if __name__ == "__main__":
    main()
