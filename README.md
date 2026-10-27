# Functioneren en opgaven · prototype

Statische viewer over hoe het mobiliteitssysteem functioneert per gebied, en waar dat tekortschiet
ten opzichte van een norm. Vervolglaag op [`rayonplannen`](https://github.com/WKSu/rayonplannen);
de achtergrond staat in `docs/overdracht-functioneren-en-opgaven.md`.

Openen: dubbelklik `index.html`. Geen buildstap, werkt onder `file://`.

## Opbouw

| Bestand | Wat |
|---|---|
| `index.html` | overzicht: alle indicatoren met normenlaag (mock-up, deels echte cijfers) |
| `parkeren.html`, `ov.html` | themaviewers: per indicator wat de datalade al kan beantwoorden en wat er nodig is |
| `css/basis.css` | gedeelde opmaak; kleurtokens gelijk aan `rayonplannen` |
| `data/indicatoren.js` | `const FUNCTIONEREN`: gebieden, normen, indicatoren en per indicator de datalade-status (handgeschreven) |
| `data/datalade.js` | `const DATALADE`: echte cijfers, gegenereerd door `scripts/bouw_datalade.py` |
| `js/app.js` | overzicht: oordeel per waarde, tabellen, kerncijfers; elk blok in een `veilig()`-guard |
| `js/thema.js` | themaviewers: kaart, tabellen en uurprofiel uit `DATALADE` |
| `js/review.js` | reviewmodus, alleen geladen met `?review=1` |

## Echte cijfers bijwerken

`data/datalade.js` komt uit twee vastgepinde, openbare checkouts. De commit van elke bron staat
in de uitvoer en onderaan elke themaviewer.

```bash
git clone --depth 1 https://github.com/WKSu/prototype-overschie ../wksu/prototype-overschie
git clone --depth 1 https://github.com/WKSu/loopbaarheid-ov ../wksu/loopbaarheid-ov
uv run scripts/bouw_datalade.py --datalade ../wksu/prototype-overschie \
    --loopbaarheid ../wksu/loopbaarheid-ov/index.html
```

Het script schrijft alleen aggregaten per gebied, buurt, sector of halte; nooit een adres.
Hernoemt een bron een veld, dan breekt het script af in plaats van een lege tabel te maken.
Daarna: `uvx ruff format scripts/ && uvx ruff check scripts/`.

## Reviewmodus

Zet `?review=1` achter de URL (`index.html?review=1`), of klik de link in de gele balk.
Per indicator (klik de regel open): *onmisbaar · nuttig · niet interessant · anders
vormgeven*, wat beter of anders moet, en welke opgave het raakt. Per sectie: wat mis je hier?
Per open vraag: je antwoord.

Opmerkingen staan in de `localStorage` van de reviewer; er gaat niets naar een server.
**Kopieer als Markdown** geeft een tekst om in een issue of chat te plakken. **Download JSON**
is de back-up en de bron van waarheid. Een opmerking hangt aan `data-onderwerp` (de
indicatorsleutel), niet aan de koptekst. Verdwijnt een sleutel, dan staat de opmerking in de
export onder "Onderwerp bestaat niet meer".

## Lagen

1. Rayon Noord buiten de Ring, Parkeren en OV, met fictieve waarden.
2. **Nu:** echte cijfers waar de datalade ze heeft (`data/datalade.js`), en een themaviewer
   per thema met wat er nog ontbreekt.
3. Deeplinks terug naar `rayonplannen` op gebiedscode.
4. Opgaven als registry: alleen bij een norm met een aanwijsbaar document.

## Regels

- Rood alleen uit een norm in `FUNCTIONEREN.normen`, met een `document`. Zonder norm: alleen tonen.
- `null` is onbekend, geen 0. Een ontbrekend cijfer blijft zichtbaar, ook met de normenlaag uit.
- Geen rayontotaal als ongewogen gemiddelde van gebieden.
- Gebiedscodes overnemen uit `rayonplannen/data/index.js`, niet met de hand typen.
