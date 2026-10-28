# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2"]
# ///
"""Bouwt data/ov-kaart.js: de vormen achter de OV-kaarten in de themaviewer.

Lijnroutes, loopgebieden rond haltes en de omtrek van gebied Rotterdam Centrum. Geen cijfers:
die staan in data/datalade.js, en dit script leest daaruit welke buurten en lijnen er op de
kaart komen. Draai dus eerst scripts/bouw_datalade.py.

    uv run scripts/bouw_ovkaart.py \\
        --datalade ../wksu/prototype-overschie \\
        --loopbaarheid ../wksu/loopbaarheid-ov/index.html

Loopgebieden van 500 m (en 1 km bij de vier grote knopen) komen uit de verkenner. Metro en trein
rekenen in de viewer met 800 m; die loopgebieden bestaan in de bron niet en worden hier over
hetzelfde looproutenetwerk uitgerekend. Alles in RD-meters, zodat afstanden kloppen; de uitvoer
is in graden.
"""

import argparse
import heapq
import json
import math
import re
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import unary_union

CENTRUM = "WK059901"
LOOP_METRO_TREIN_M = 800  # gelijk aan bouw_datalade.py
BUFFER_M = 30  # naast de route; zo vallen de eigen 500 m-gebieden samen met die van de bron (--ijk)
VEREENVOUDIG_M = 8  # lijnroutes; een pixel op een kaart van 800 px breed is ~20 m
ZONE_VEREENVOUDIG_M = 15  # loopgebieden: de rand is toch al een benadering
MIN_GAT_M2 = 5000  # kleinere gaten in een loopgebied vallen weg
LIJNEN_MARGE_M = 1500  # lijnroutes lopen tot zo ver buiten rayon en centrum door
INZET_STRAAL_M = 500
INZET_PERCENTIEL = 0.2  # een halte waar het omlopen goed te zien is, geen uitschieter

DAGDELEN = ("os", "dal", "av")  # gelijk aan bouw_datalade.py
SNEL = {"metro", "trein"}


# RD ↔ WGS84 met de benaderingsformules van de verkenner (nauwkeurig op ongeveer een meter).
def rd2wgs(x, y):
    dx, dy = (x - 155000) * 1e-5, (y - 463000) * 1e-5
    sl = [(0, 1, 3235.65389), (2, 0, -32.58297), (0, 2, -0.24750), (2, 1, -0.84978),
          (0, 3, -0.06550), (2, 2, -0.01709), (1, 0, -0.00738), (4, 0, 0.00530),
          (2, 3, -0.00039), (4, 1, 0.00033), (1, 1, -0.00012)]  # fmt: skip
    so = [(1, 0, 5260.52916), (1, 1, 105.94684), (1, 2, 2.45656), (3, 0, -0.81885),
          (1, 3, 0.05594), (3, 1, -0.05607), (0, 1, 0.01199), (3, 2, -0.00256),
          (1, 4, 0.00128), (0, 2, 0.00022), (2, 0, -0.00022), (5, 0, 0.00026)]  # fmt: skip
    lat = 52.15517440 + sum(c * dx**p * dy**q for p, q, c in sl) / 3600
    lon = 5.38720621 + sum(c * dx**p * dy**q for p, q, c in so) / 3600
    return lon, lat


def wgs2rd(lon, lat):
    dphi, dlam = 0.36 * (lat - 52.15517440), 0.36 * (lon - 5.38720621)
    r = [(0, 1, 190094.945), (1, 1, -11832.228), (2, 1, -114.221), (0, 3, -32.391),
         (1, 0, -0.705), (3, 1, -2.340), (1, 3, -0.608), (0, 2, -0.008), (2, 3, 0.148)]  # fmt: skip
    s = [(1, 0, 309056.544), (0, 2, 3638.893), (2, 0, 73.077), (1, 2, -157.984),
         (3, 0, 59.788), (0, 1, 0.433), (2, 2, -6.439), (1, 1, -0.032), (0, 4, 0.092),
         (1, 4, -0.054)]  # fmt: skip
    x = 155000 + sum(c * dphi**p * dlam**q for p, q, c in r)
    y = 463000 + sum(c * dphi**p * dlam**q for p, q, c in s)
    return x, y


def naar_rd(geom):
    return shapely.transform(geom, lambda xy: [wgs2rd(x, y) for x, y in xy])


def naar_graden(geom):
    return shapely.transform(geom, lambda xy: [rd2wgs(x, y) for x, y in xy])


def lees_const(pad: Path):
    tekst = pad.read_text(encoding="utf-8")
    m = re.search(r"^const (\w+) = (.*);\s*$", tekst, re.MULTILINE | re.DOTALL)
    if not m:
        raise ValueError(f"{pad}: geen 'const NAAM = …;' gevonden")
    return json.loads(m.group(2))


def json_blok(html: str, blok_id: str):
    m = re.search(
        rf'<script id="{blok_id}" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        raise ValueError(f"loopbaarheid-ov: blok {blok_id} ontbreekt")
    return json.loads(m.group(1))


def codeer(punten) -> str:
    """Een ring of lijn als zigzag-verschillen in eenheden van 1e-5 graad (~1 m), in base36:
    het schema van de verkenner zelf, drie keer zo klein als getallen. Decoderen doet
    ovPunten() in js/thema.js."""
    cijfers = "0123456789abcdefghijklmnopqrstuvwxyz"

    def b36(z):
        s = ""
        while True:
            z, r = divmod(z, 36)
            s = cijfers[r] + s
            if not z:
                return s

    uit_, vorig = [], (0, 0)
    for lon, lat in punten:
        p = (round(lon * 1e5), round(lat * 1e5))
        if p == vorig:
            continue
        uit_ += [
            b36(-2 * d - 1 if d < 0 else 2 * d)
            for d in (p[0] - vorig[0], p[1] - vorig[1])
        ]
        vorig = p
    return ",".join(uit_)


def uit_vlak(geom_rd, tolerantie=VEREENVOUDIG_M) -> list:
    """Vlak als lijst van polygonen, elk een lijst van gecodeerde ringen (buitenrand eerst).
    Kleine gaten (binnenterreinen verder dan 30 m van een route) vallen weg: op de kaart zijn
    het haarlijnen, geen informatie."""
    g = geom_rd.simplify(tolerantie)
    uit_ = []
    for p in g.geoms if g.geom_type == "MultiPolygon" else [g]:
        if p.is_empty:
            continue
        gaten = [r for r in p.interiors if Polygon(r).area >= MIN_GAT_M2]
        p = naar_graden(Polygon(p.exterior, gaten))
        uit_.append(
            [codeer(p.exterior.coords), *(codeer(r.coords) for r in p.interiors)]
        )
    return uit_


def uit_lijn(geom_rd) -> list:
    g = naar_graden(geom_rd.simplify(VEREENVOUDIG_M))
    delen = g.geoms if hasattr(g, "geoms") else [g]
    return [codeer(d.coords) for d in delen if d.geom_type == "LineString"]


# ---------- looproutenetwerk ----------


def dec_zigzag(s: str, schaal: float) -> list[float]:
    uit_, vorig = [], 0
    for p in s.split(","):
        z = int(p, 36)
        vorig += -((z + 1) >> 1) if z & 1 else z >> 1
        uit_.append(vorig / schaal)
    return uit_


class Netwerk:
    """Het looproutenetwerk van de verkenner (blok d-scn): knopen in RD-meters, randen met lengte."""

    CEL = 70

    def __init__(self, scn: dict):
        self.x, self.y = dec_zigzag(scn["nx"], 10), dec_zigzag(scn["ny"], 10)
        eu = [int(v) for v in dec_zigzag(scn["eu"], 1)]
        ev = [u + int(r, 36) for u, r in zip(eu, scn["ev"].split(","))]
        lengte = [int(v, 36) / 10 for v in scn["el"].split(",")]
        self.randen = list(zip(eu, ev, lengte))
        self.voorkeur = scn["ew"]  # "1": rand waar een halte bij voorkeur op aansluit
        self.buren = [[] for _ in self.x]
        for u, v, lengte_ in self.randen:
            self.buren[u].append((v, lengte_))
            self.buren[v].append((u, lengte_))
        self.rooster = {}
        for e, (u, v, _) in enumerate(self.randen):
            for cx in range(
                self._c(min(self.x[u], self.x[v])),
                self._c(max(self.x[u], self.x[v])) + 1,
            ):
                for cy in range(self._c(min(self.y[u], self.y[v])), self._c(max(self.y[u], self.y[v])) + 1):  # fmt: skip
                    self.rooster.setdefault((cx, cy), []).append(e)
        self.haltes = [
            [(a[i] / 10, a[i + 1] / 10) for i in range(0, len(a), 2)] for a in scn["hq"]
        ]

    def _c(self, v):
        return int(v // self.CEL)

    def aansluiting(self, px, py):
        """Dichtstbijzijnde rand, met voorkeur voor randen die de bron als aansluiting markeert;
        zoals de verkenner. Geeft twee startknopen met hun afstand."""
        beste = {True: (1e18, None, 0), False: (1e18, None, 0)}
        for straal in range(9):
            for cx in range(self._c(px) - straal, self._c(px) + straal + 1):
                for cy in range(self._c(py) - straal, self._c(py) + straal + 1):
                    if max(abs(cx - self._c(px)), abs(cy - self._c(py))) != straal:
                        continue
                    for e in self.rooster.get((cx, cy), []):
                        u, v, _ = self.randen[e]
                        ax, ay = self.x[u], self.y[u]
                        vx, vy = self.x[v] - ax, self.y[v] - ay
                        l2 = vx * vx + vy * vy
                        t = (
                            min(1, max(0, ((px - ax) * vx + (py - ay) * vy) / l2))
                            if l2
                            else 0
                        )
                        d = math.hypot(px - ax - t * vx, py - ay - t * vy)
                        k = self.voorkeur[e] == "1"
                        if d < beste[k][0]:
                            beste[k] = (d, e, t)
            if beste[True][1] is not None or beste[False][1] is not None:
                break
        d, e, t = beste[True] if beste[True][1] is not None else beste[False]
        u, v, _ = self.randen[e]
        seg = math.hypot(self.x[v] - self.x[u], self.y[v] - self.y[u])
        return [(u, d + t * seg), (v, d + (1 - t) * seg)]

    def loopgebied(self, halte: int, grens: float):
        """Alles binnen `grens` meter lopen vanaf een van de perrons van de halte, als vlak."""
        afstand = {}
        rij = [(d, n) for q in self.haltes[halte] for n, d in self.aansluiting(*q)]
        heapq.heapify(rij)
        while rij:
            d, n = heapq.heappop(rij)
            if n in afstand or d >= grens:
                continue
            afstand[n] = d
            for m, lengte in self.buren[n]:
                if m not in afstand and d + lengte < grens:
                    heapq.heappush(rij, (d + lengte, m))
        stukken = []
        for n, d in afstand.items():
            for m, lengte in self.buren[n]:
                # Vanaf n zo ver als de grens toelaat; staat m er ook in, dan loopt het stuk
                # vanaf m het andere eind op.
                rest = min(1.0, (grens - d) / lengte) if lengte else 1.0
                a, b = (self.x[n], self.y[n]), (self.x[m], self.y[m])
                stukken.append(
                    LineString(
                        [a, (a[0] + rest * (b[0] - a[0]), a[1] + rest * (b[1] - a[1]))]
                    )
                )
        return unary_union([s.buffer(BUFFER_M, quad_segs=4) for s in stukken])


# ---------- opbouw ----------


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
    wortel = Path(__file__).resolve().parent.parent
    ap.add_argument("--cijfers", type=Path, default=wortel / "data/datalade.js")
    ap.add_argument("--uit", type=Path, default=wortel / "data/ov-kaart.js")
    ap.add_argument(
        "--ijk", action="store_true", help="vergelijk eigen 500 m-gebieden met de bron"
    )
    a = ap.parse_args()

    cijfers = lees_const(a.cijfers)["ov"]
    html = a.loopbaarheid.read_text(encoding="utf-8")
    data = json_blok(html, "d-data")
    haltes, lijnen_bron = data["haltes"], data["lijnen"]

    rayon = unary_union(
        [
            naar_rd(shape(b["geometrie"])).buffer(0)
            for g in cijfers["perGebied"].values()
            for b in g["buurten"]
        ]
    )
    centrum = unary_union(
        [
            naar_rd(shape(f["geometry"])).buffer(0)
            for f in lees_const(a.datalade / f"data/{CENTRUM}/geo.js")["features"]
        ]
    )

    # Loopgebieden uit de bron: k=0 is 500 m, k=1 is 1 km rond de vier grote knopen.
    iso = {
        (f["properties"]["id"], f["properties"]["k"]): naar_rd(
            shape(f["geometry"])
        ).buffer(0)
        for f in json_blok(html, "d-iso")["features"]
    }
    net = Netwerk(json_blok(html, "d-scn"))

    if a.ijk:
        ijk(net, iso, haltes, rayon)
        return

    # Haltes waarvan een loopgebied in het rayon komt. Metro en trein: een station tot 800 m
    # hemelsbreed buiten het rayon kan er nog in reiken; het netwerk is altijd langer.
    dd = {k: data["hlf_keys"].index(k) for k in DAGDELEN}
    zones = []
    for h in haltes:
        i = h["id"]
        punt = Point(wgs2rd(h["lon"], h["lat"]))
        snel = bool(SNEL & set(h["m"]))
        vlakken = {"z500": iso[(i, 0)]}
        if (i, 1) in iso:
            vlakken["z1000"] = iso[(i, 1)]
        if snel and punt.distance(rayon) <= LOOP_METRO_TREIN_M:
            vlakken["z800"] = net.loopgebied(i, LOOP_METRO_TREIN_M)
        if not any(v.intersects(rayon) for v in vlakken.values()):
            continue
        # Beste frequentie per dagdeel, apart voor bus en tram en voor metro en trein: die
        # hebben een ander loopgebied.
        freq = {k: [0, 0] for k in DAGDELEN}
        for li, f in zip(data["hlk"][i], data["hlf"][i]):
            s = int(lijnen_bron[li]["mode"] in SNEL)
            for k, j in dd.items():
                freq[k][s] = max(freq[k][s], f[j])
        zones.append(
            {
                "naam": h["n"],
                "modi": h["m"],
                "lon": h["lon"],
                "lat": h["lat"],
                **freq,
                **{k: uit_vlak(v, ZONE_VEREENVOUDIG_M) for k, v in vlakken.items()},
                "_punt": punt,
                "_z500": vlakken["z500"],
                "_a": h.get("a", 0),
            }
        )

    # Inzet: één halte in het rayon met zijn loopgebied naast een cirkel van 500 m hemelsbreed.
    kandidaten = sorted(
        (z["_z500"].area / (math.pi * INZET_STRAAL_M**2), z["naam"], n)
        for n, z in enumerate(zones)
        if not SNEL & set(z["modi"]) and rayon.contains(z["_punt"]) and z["_a"] >= 300
    )
    verhouding, _, inzet = kandidaten[int(INZET_PERCENTIEL * len(kandidaten))]

    # Lijnroutes: alleen lijnen uit de cijfers, geknipt op rayon en centrum met marge.
    kader = box(*unary_union([rayon, centrum]).bounds).buffer(
        LIJNEN_MARGE_M, join_style=2
    )
    routes = {}
    for f in json_blok(html, "d-lijnen")["features"]:
        li = str(f["properties"]["i"])
        if li not in cijfers["lijnen"]:
            continue
        stuk = naar_rd(shape(f["geometry"])).intersection(kader)
        if not stuk.is_empty:
            routes[li] = uit_lijn(stuk)

    uitvoer = {
        "centrum": {
            "naam": "Rotterdam Centrum",
            "vlak": uit_vlak(centrum, ZONE_VEREENVOUDIG_M),
        },
        "lijnen": routes,
        "zones": [{k: v for k, v in z.items() if not k.startswith("_")} for z in zones],
        "inzet": {
            "zone": inzet,
            "straalM": INZET_STRAAL_M,
            "aandeelVanCirkel": round(100 * verhouding),
        },
        "loopgebied": {
            "bron500": "loopgebieden van de verkenner (500 m, 1 km rond de grote knopen)",
            "eigen800": f"zelf berekend over het looproutenetwerk van de verkenner, {BUFFER_M} m aan weerszijden van de route",
        },
    }
    tekst = json.dumps(uitvoer, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_ovkaart.py. Niet met de hand bewerken.\n"
        f"const OVKAART = {tekst};\n",
        encoding="utf-8",
    )
    print(
        f"{a.uit}: {len(tekst) / 1024:.0f} kB; {len(zones)} haltes, "
        f"{sum('z800' in z for z in zones)} met 800 m, {len(routes)} lijnen; "
        f"inzet {zones[inzet]['naam']} ({round(100 * verhouding)}% van de cirkel)"
    )


def ijk(net, iso, haltes, rayon):
    """Leg het eigen 500 m-gebied naast dat van de bron, voor haltes in het rayon."""
    for h in haltes:
        p = Point(wgs2rd(h["lon"], h["lat"]))
        if not rayon.contains(p) or h["id"] % 7:
            continue
        eigen, bron = net.loopgebied(h["id"], 500), iso[(h["id"], 0)]
        iou = eigen.intersection(bron).area / eigen.union(bron).area
        print(
            f"{h['n']:<40} eigen/bron {eigen.area / bron.area:5.2f}  overlap {iou:4.2f}"
        )


if __name__ == "__main__":
    main()
