# Functioneren en opgaven · prototype

Statische viewer over hoe het mobiliteitssysteem functioneert per gebied, en waar dat tekortschiet
ten opzichte van een norm. Vervolglaag op [`rayonplannen`](https://github.com/WKSu/rayonplannen);
de achtergrond staat in `docs/overdracht-functioneren-en-opgaven.md`.

Openen: dubbelklik `index.html`. Geen buildstap, werkt onder `file://`. De kaarten halen hun
ondergrond (BRT-Achtergrondkaart grijs) live bij PDOK; zonder internet blijven ze leesbaar, zonder ondergrond.

## Opbouw

| Bestand | Wat |
|---|---|
| `index.html` | overzicht: alle indicatoren met normenlaag (mock-up, deels echte cijfers) |
| `parkeren.html`, `ov.html` | themaviewers: per indicator wat de datalade al kan beantwoorden en wat er nodig is |
| `css/basis.css` | gedeelde opmaak; huisstijlkleuren gemeente Rotterdam, alleen licht |
| `data/indicatoren.js` | `const FUNCTIONEREN`: gebieden, normen, indicatoren en per indicator de datalade-status (handgeschreven) |
| `data/datalade.js` | `const DATALADE`: echte cijfers, gegenereerd door `scripts/bouw_datalade.py` |
| `data/parkeerdruk.js` | `const PARKEERDRUK`: gemeten parkeerdruk uit de parkeertellingen, gegenereerd door `scripts/bouw_parkeerdruk.py` |
| `data/rapportcijfer.js` | `const RAPPORTCIJFER`: rapportcijfer parkeren bij de woning per gebied (Omnibusenquête), gegenereerd door `scripts/bouw_rapportcijfer.py` |
| `data/fietsparkeren.js` | `const FIETSPARKEREN`: capaciteit en fietsparkeerdruk uit de fietsparkeertellingen, gegenereerd door `scripts/bouw_fietsparkeren.py` |
| `data/ruimtebeslag.js` | `const RUIMTEBESLAG`: parkeren ÷ openbare ruimte per subbuurt(deel), gegenereerd door `scripts/bouw_ruimtebeslag.py` |
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

### Meerzijdige bereikbaarheid (OV)

Drie maten per woonadres, opgeteld per buurt en gebied: de **vervoersmix** (minstens twee soorten
OV op loopafstand), de **richting-check** (een lijn op loopafstand die niet door gebied Rotterdam
Centrum rijdt) en de **storingstest** (wie geen bruikbaar OV overhoudt als de kwetsbaarste
corridor uitvalt). Loopafstand: 500 m naar bus en tram (de bron heeft per halte alleen
adreslijsten tot 500 m), 800 m naar metro en trein. Een lijn telt mee bij minstens 2 vertrekken
per uur per richting in het dal. Een corridor is een lijn met de lijnen van dezelfde vervoerwijze
die de helft van zijn haltes delen. Alle drempels staan bovenaan `scripts/bouw_datalade.py`.
Het bereik binnen 30 minuten vraagt een reisplanner en banen per locatie; die zijn er nog niet.

## Parkeertellingen bijwerken

`data/parkeerdruk.js` komt uit de handmatige levering in `data_manual/parkeerdruk/data`: de zips
van de parkeertellingen (Excel per subbuurtdeel), en de shapefiles `Subbuurtdelen` en
`parkeersectoren`. Een nieuwe telling is een nieuwe zip met de naam
`Parkeertelling <gebied> (<projectcode>).zip`.

```bash
uv run scripts/bouw_parkeerdruk.py
```

Maatgevend is de werkdagnacht (ma–vr, start tussen 23 en 5 uur); bij meer nachten het
gemiddelde. Zonder werkdagnacht telt een werkdagavond vanaf 20 uur; zonder beide staat de telling
op de kaart, maar telt niet mee. Zijn er twee tellingen in één subbuurtdeel, dan telt de
recentste met een werkdagnacht. De Spaanse Polder (gebied 18, buiten het rayon) staat in de
analyse, niet in de gebiedscijfers van het overzicht (`EXTRA` in het script). Het script
schrijft alleen aggregaten per subbuurtdeel, subbuurt en sector, en breekt af als een veld
ontbreekt of een subbuurtdeel een andere buurtnaam heeft dan de shapefile.

## Rapportcijfer, fietsparkeren en ruimtebeslag bijwerken

```bash
uv run scripts/bouw_rapportcijfer.py     # data_manual/rapportcijfer parkeren/*.xlsx, blad Resultaat
uv run scripts/bouw_fietsparkeren.py     # data_manual/fietsparkeertellingen/*.zip (Ecorys)
uv run scripts/haal_bgt.py               # BGT-extract voor het rayon bij PDOK, ~minuten
uv run scripts/bouw_ruimtebeslag.py      # BGT + capaciteit uit de tellingen
```

Ruimtebeslag: waar geteld is, de capaciteit (algemeen + bijzonder) maal een oppervlak per plek;
elders de BGT-parkeervlakken. Het oppervlak per plek is geijkt op de getelde subbuurtdelen, zodat
beide bronnen op dezelfde schaal staan. De noemer is de openbare ruimte uit de BGT zonder water,
gebouwen, erven, landbouwgrond, snelweg, spoor, landingsbaan en grote parken (aaneengesloten
groen vanaf 1 ha). De handmatige BGT-uitsnede in `data_manual/bgt_noord_buitenring` mist
ongeveer de helft van de vlakken en wordt niet gebruikt.

Fietsparkeerdruk: alle gestalde fietsen (in, nabij en buiten een voorziening) ÷ capaciteit van de
voorzieningen, op het drukste van de vier meetmomenten per telling.

Het overzicht (`index.html`) toont alleen indicatoren waarvoor een echt cijfer geladen is; de
rest staat met wat er nodig is in de themaviewer.

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
