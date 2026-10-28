# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""Bouwt data/rapportcijfer.js: rapportcijfer parkeren bij de eigen woning, per gebied.

Leest data_manual/rapportcijfer parkeren/Rapportcijfer parkeren bij eigen woning.xlsx, blad
Resultaat: de tabel uit de Omnibusenquête (2022 t/m 2026 samengevoegd) voor de drie gebieden.

    uv run scripts/bouw_rapportcijfer.py
"""

import argparse
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
GEBIEDEN = {
    "Overschie": "WK059904",
    "Hillegersberg-Schiebroek": "WK059906",
    "Prins Alexander": "WK059914",
}
KLASSEN = ["Onvoldoende", "Net voldoende", "Ruim voldoende", "Goed"]
# Regel uit het rapport: onder 200 waarnemingen indicatief, onder 50 niet getoond.
INDICATIEF_N = 200
# Alleen als plaatje in het werkboek (tabel 6.3-vervolg, kolom Rotterdam); ter vergelijking.
ROTTERDAM = {"cijfer": 6.2, "onvoldoende": 24, "n": 3570}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--xlsx",
        type=Path,
        default=ROOT
        / "data_manual/rapportcijfer parkeren/Rapportcijfer parkeren bij eigen woning.xlsx",
    )
    ap.add_argument("--uit", type=Path, default=ROOT / "data/rapportcijfer.js")
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.xlsx, read_only=True, data_only=True)
    rijen = [r for r in wb["Resultaat"].iter_rows(values_only=True)]
    wb.close()
    # Kop: de rij waarin de drie gebiedsnamen naast elkaar staan; labels staan in kolom B.
    kop_i = next(i for i, r in enumerate(rijen) if all(g in r for g in GEBIEDEN))
    kolom = {g: rijen[kop_i].index(g) for g in GEBIEDEN}
    label = {r[1]: r for r in rijen[kop_i + 1 :] if r[1]}
    ontbreekt = [
        k for k in [*KLASSEN, "Totaal absoluut", "Rapportcijfer"] if k not in label
    ]
    if ontbreekt:
        raise KeyError(f"Resultaat: rijen ontbreken: {', '.join(ontbreekt)}")

    gebieden = {}
    for naam, code in GEBIEDEN.items():
        c = kolom[naam]
        verdeling = {k: round(100 * label[k][c]) for k in KLASSEN}
        if abs(sum(verdeling.values()) - 100) > 1:
            raise ValueError(
                f"{naam}: verdeling telt op tot {sum(verdeling.values())}%"
            )
        n = int(label["Totaal absoluut"][c])
        gebieden[code] = {
            "cijfer": label["Rapportcijfer"][c],
            "onvoldoende": verdeling["Onvoldoende"],
            "verdeling": verdeling,
            "n": n,
            "indicatief": n < INDICATIEF_N,
        }

    # Rayon: gewogen naar respondenten. Alleen ter informatie; het overzicht toont geen rayontotaal.
    n = sum(g["n"] for g in gebieden.values())
    rayon = {
        "cijfer": round(sum(g["cijfer"] * g["n"] for g in gebieden.values()) / n, 1),
        "onvoldoende": round(
            sum(g["onvoldoende"] * g["n"] for g in gebieden.values()) / n
        ),
        "n": n,
    }
    uit = {
        "bron": "Omnibusenquête gemeente Rotterdam, oordeel over de mogelijkheden om de auto bij de woning te parkeren (exclusief ‘geen mening’), per gebied (handmatig aangeleverd)",
        "periode": "2022 t/m 2026 samengevoegd",
        "regel": f"onder {INDICATIEF_N} waarnemingen is de uitkomst indicatief (regel uit het rapport)",
        "klassen": KLASSEN,
        "gebieden": gebieden,
        "rayon": rayon,
        "rotterdam": ROTTERDAM,
    }
    tekst = json.dumps(uit, ensure_ascii=False, separators=(",", ":"))
    a.uit.write_text(
        "// Gegenereerd door scripts/bouw_rapportcijfer.py. Niet met de hand bewerken.\n"
        f"const RAPPORTCIJFER = {tekst};\n",
        encoding="utf-8",
    )
    for code, g in gebieden.items():
        print(f"  {code}: {g['cijfer']} ({g['onvoldoende']}% onvoldoende, n={g['n']})")
    print(f"  rayon: {rayon['cijfer']} ({rayon['onvoldoende']}% onvoldoende, n={n})")


if __name__ == "__main__":
    main()
