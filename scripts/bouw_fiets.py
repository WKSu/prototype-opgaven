# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2"]
# ///
"""Bouwt data/fiets.js: maaswijdte, ontbrekende schakels en verkeerslichten op het fietsnetwerk.

Leest de handmatige levering in data_manual/fiets (themateam Fiets, oktober 2026):

- Fietsnetwerk_NoordBuitenRing.gpkg: de netwerkkaart fiets op het NWB (oktober 2025), met per
  wegvak het netwerktype. `new_*` zijn schakels van de netwerkkaart die er nog niet liggen.
- OSM_NoordBuitenRing_Fiets_mazen.gpkg: de mazen van het befietsbare OSM-netwerk, als vlakken.
- VRIs_NoordBuitenRing.gpkg: verkeersregelinstallaties uit de lijst VRI-vervangingen (2023).

    uv run scripts/bouw_fiets.py

De gebieden en buurten komen uit data/datalade.js; draai dus eerst scripts/bouw_datalade.py.
Alles in RD-meters, de uitvoer in graden.
"""

import argparse
import json
import sqlite3
from pathlib import Path

import shapely
from bouw_datalade import GEBIEDEN, lees_const
from bouw_ovkaart import codeer, naar_graden, naar_rd, uit_lijn
from shapely.geometry import shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parent.parent
BRON = ROOT / "data_manual/fiets"
NETWERK = ("fiets_primary", "fiets_secondary", "fiets_tertiary")
NIEUW = {f"new_{t}": t for t in NETWERK}
# Maaswijdte ≈ omtrek ÷ 4: de zijde van een vierkant met dezelfde omtrek. De levering toetst de
# omtrek aan 1000 m ('500 + 500'), maar omtrek_m is de hele rand (vier zijden); twee zijden van
# 500 m horen bij een omtrek van 2000 m. De viewer stelt de grens in, met 500 m als standaard.
MAAS_KLEINST_M = 125  # kleinere mazen gaan niet mee: ze zijn bij elke grens fijnmazig
MAAS_VEREENVOUDIG_M = 3
SCHAKEL_SAMEN_M = (
    5  # stukjes ontbrekende schakel die elkaar zo dicht raken, zijn één schakel
)
VRI_OP_NETWERK_M = (
    25  # een VRI regelt een kruising op de route als hij zo dichtbij staat
)


def lagen(pad: Path):
    """Alle rijen van de enige laag in een GeoPackage, met de geometrie als shapely-object."""
    c = sqlite3.connect(pad)
    (tabel,) = c.execute("select table_name from gpkg_contents").fetchone()
    (kolom,) = c.execute(
        "select column_name from gpkg_geometry_columns where table_name = ?", (tabel,)
    ).fetchone()
    cur = c.execute(f'select * from "{tabel}"')
    namen = [d[0] for d in cur.description]
    for rij in cur:
        r = dict(zip(namen, rij))
        b = r.pop(kolom)
        # GPKG-kop: 'GP', versie, vlaggen, srs-id, dan een envelop van 0 tot 64 bytes.
        envelop = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(b[3] >> 1) & 7]
        r["geom"] = shapely.from_wkb(bytes(b[8 + envelop :]))
        yield r


def eis(rij: dict, *velden: str, waar: str):
    # Een hernoemd veld moet luid falen, niet als lege kaart verschijnen.
    ontbreekt = [v for v in velden if v not in rij]
    if ontbreekt:
        raise KeyError(f"{waar}: velden ontbreken: {', '.join(ontbreekt)}")


def grootste(geom, vlakken: dict):
    """Het vlak (sleutel) waarmee geom het meest overlapt; voor een punt het vlak eromheen."""
    if geom.geom_type == "Point":
        return next((k for k, v in vlakken.items() if v.contains(geom)), None)
    maat = "area" if geom.geom_type.endswith("Polygon") else "length"
    beste = max(vlakken, key=lambda k: getattr(geom.intersection(vlakken[k]), maat))
    return beste if getattr(geom.intersection(vlakken[beste]), maat) > 0 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--uit", type=Path, default=ROOT / "data/fiets.js")
    a = ap.parse_args()

    ov = lees_const(ROOT / "data/datalade.js")["ov"]
    buurt_vlak, buurt_gebied = {}, {}
    for code in GEBIEDEN:
        for b in ov["perGebied"][code]["buurten"]:
            buurt_vlak[b["naam"]] = naar_rd(shape(b["geometrie"])).buffer(0)
            buurt_gebied[b["naam"]] = code
    gebied_vlak = {
        c: unary_union([v for b, v in buurt_vlak.items() if buurt_gebied[b] == c])
        for c in GEBIEDEN
    }

    # ---------- netwerkkaart ----------
    wegvakken = list(lagen(BRON / "Fietsnetwerk_NoordBuitenRing.gpkg"))
    eis(wegvakken[0], "netwerktype", "STT_NAAM", waar="Fietsnetwerk")
    onbekend = {r["netwerktype"] for r in wegvakken} - {None, *NETWERK, *NIEUW}
    if onbekend:
        raise ValueError(f"Fietsnetwerk: onbekend netwerktype {sorted(onbekend)}")
    bestaand = {
        t: unary_union([r["geom"] for r in wegvakken if r["netwerktype"] == t])
        for t in NETWERK
    }
    km = {
        c: {t: round(bestaand[t].intersection(v).length / 1000, 2) for t in NETWERK}
        for c, v in gebied_vlak.items()
    }
    straten = [r for r in wegvakken if r["STT_NAAM"]]
    boom = shapely.STRtree([r["geom"] for r in straten])

    def straat_bij(punt):
        return straten[boom.nearest(punt)]["STT_NAAM"]

    schakels = []
    for t in NETWERK:
        stukken = [r["geom"] for r in wegvakken if NIEUW.get(r["netwerktype"]) == t]
        if not stukken:
            continue
        # Stukjes die elkaar raken, worden één schakel.
        samen = unary_union([s.buffer(SCHAKEL_SAMEN_M) for s in stukken])
        for groep in getattr(samen, "geoms", [samen]):
            lijn = unary_union([s for s in stukken if s.intersects(groep)])
            if lijn.geom_type != "LineString":
                lijn = linemerge(lijn)
            delen = getattr(lijn, "geoms", [lijn])
            begin, eind = (
                shapely.Point(delen[0].coords[0]),
                shapely.Point(delen[-1].coords[-1]),
            )
            van, naar = straat_bij(begin), straat_bij(eind)
            buurt = grootste(lijn, buurt_vlak)
            schakels.append(
                {
                    "type": t,
                    "gebied": buurt_gebied.get(buurt),
                    "buurt": buurt,
                    "lengteM": round(lijn.length),
                    "bij": van if van == naar else f"{van} – {naar}",
                    "lijn": uit_lijn(lijn),
                }
            )
    schakels.sort(key=lambda s: -s["lengteM"])

    # ---------- mazen ----------
    mazen_alle = list(lagen(BRON / "OSM_NoordBuitenRing_Fiets_mazen.gpkg"))
    eis(mazen_alle[0], "maas_id", "omtrek_m", "oppervlak_m2", waar="mazen")
    oppervlak = dict.fromkeys(GEBIEDEN, 0.0)
    aantal = dict.fromkeys(GEBIEDEN, 0)
    mazen = []
    for r in mazen_alle:
        buurt = grootste(r["geom"], buurt_vlak)
        if buurt is None:
            continue
        code = buurt_gebied[buurt]
        oppervlak[code] += r["oppervlak_m2"]
        aantal[code] += 1
        breedte = r["omtrek_m"] / 4
        if breedte < MAAS_KLEINST_M:
            continue
        p = naar_graden(r["geom"].simplify(MAAS_VEREENVOUDIG_M))
        mazen.append(
            {
                "id": r["maas_id"],
                "gebied": code,
                "buurt": buurt,
                "breedteM": round(breedte),
                "omtrekM": round(r["omtrek_m"]),
                "ha": round(r["oppervlak_m2"] / 1e4, 1),
                "vlak": [codeer(p.exterior.coords)],
            }
        )
    mazen.sort(key=lambda m: -m["breedteM"])

    # ---------- VRI's ----------
    netwerk = unary_union(list(bestaand.values()))
    vris = []
    for r in lagen(BRON / "VRIs_NoordBuitenRing.gpkg"):
        eis(r, "VRI naam", "Installatietype", waar="VRI's")
        lon, lat = r["geom"].x, r["geom"].y
        punt = naar_rd(shapely.Point(lon, lat))
        code = grootste(punt, {c: v.buffer(30) for c, v in gebied_vlak.items()})
        vris.append(
            {
                "naam": r["VRI naam"],
                "soort": r["Installatietype"],
                "gebied": code,
                "opNetwerk": netwerk.distance(punt) <= VRI_OP_NETWERK_M,
                "lon": round(lon, 6),
                "lat": round(lat, 6),
            }
        )

    uit = {
        "bron": "Levering themateam Fiets (oktober 2026): netwerkkaart fiets op het NWB, mazen uit OpenStreetMap, VRI-vervangingen 2023",
        "netwerktypen": list(NETWERK),
        "keuzes": {
            "maasKleinstM": MAAS_KLEINST_M,
            "schakelSamenM": SCHAKEL_SAMEN_M,
            "vriOpNetwerkM": VRI_OP_NETWERK_M,
        },
        "gebieden": {
            c: {
                "km": km[c],
                "mazen": aantal[c],
                "mazenHa": round(oppervlak[c] / 1e4, 1),
            }
            for c in GEBIEDEN
        },
        "netwerk": {t: uit_lijn(bestaand[t]) for t in NETWERK},
        "schakels": schakels,
        "mazen": mazen,
        "vris": vris,
    }

    print(f"{len(wegvakken)} wegvakken, {len(mazen_alle)} mazen, {len(vris)} VRI's")
    for c in GEBIEDEN:
        ms = [m for m in mazen if m["gebied"] == c]
        print(
            f"  {c}: netwerkkaart {sum(km[c].values()):.1f} km, "
            f"mazen {aantal[c]} (>250 m: {sum(m['breedteM'] > 250 for m in ms)}, "
            f">500 m: {sum(m['breedteM'] > 500 for m in ms)}), "
            f"schakels {sum(s['gebied'] == c for s in schakels)}, "
            f"VRI's op netwerk {sum(v['gebied'] == c and v['opNetwerk'] for v in vris)}"
        )
    for s in schakels:
        print(f"    schakel {s['type']} {s['lengteM']} m bij {s['bij']} ({s['buurt']})")
    buiten = [v["naam"] for v in vris if v["gebied"] is None]
    print(f"  VRI's buiten het rayon: {buiten}")

    tekst = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_fiets.py. Niet met de hand bewerken.\n"
        f"const FIETS = {tekst};\n",
        encoding="utf-8",
    )
    print(f"{a.uit}: {len(tekst) / 1024:.0f} kB")


if __name__ == "__main__":
    main()
