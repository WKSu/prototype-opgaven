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
| `parkeren.html`, `ov.html`, `fiets.html` | themaviewers: per indicator wat hij zegt, hoe hij gemeten is en waar je op let, met kaarten en tabellen die aan elkaar gekoppeld zijn |
| `css/basis.css` | gedeelde opmaak; huisstijlkleuren gemeente Rotterdam, alleen licht |
| `data/indicatoren.js` | `const FUNCTIONEREN`: gebieden, normen, indicatoren en per indicator de datalade-status (handgeschreven) |
| `data/datalade.js` | `const DATALADE`: echte cijfers, gegenereerd door `scripts/bouw_datalade.py` |
| `data/ov-kaart.js` | `const OVKAART`: lijnroutes, loopgebieden rond haltes en de omtrek van gebied Rotterdam Centrum voor de OV-kaarten, gegenereerd door `scripts/bouw_ovkaart.py`; alleen vormen, geen cijfers |
| `data/parkeerdruk.js` | `const PARKEERDRUK`: gemeten parkeerdruk uit de parkeertellingen, gegenereerd door `scripts/bouw_parkeerdruk.py` |
| `data/rapportcijfer.js` | `const RAPPORTCIJFER`: rapportcijfer parkeren bij de woning per gebied (Omnibusenquête), gegenereerd door `scripts/bouw_rapportcijfer.py` |
| `data/fietsparkeren.js` | `const FIETSPARKEREN`: capaciteit en fietsparkeerdruk uit de fietsparkeertellingen, gegenereerd door `scripts/bouw_fietsparkeren.py` |
| `data/woningbouw.js` | `const WONINGBOUW`: woningbouwprojecten uit BoPro per subbuurt, context in de Parkeren-viewer, gegenereerd door `scripts/bouw_woningbouw.py` |
| `data/pr.js` | `const PR`: P+R-terreinen met capaciteit uit het Nationaal Parkeerregister (RDW), opgehaald met `scripts/haal_npr.py` |
| `data/fiets.js` | `const FIETS`: netwerkkaart fiets, ontbrekende schakels, mazen en VRI's voor de Fiets-viewer, gegenereerd door `scripts/bouw_fiets.py` |
| `data/toegankelijkheid.js` | `const TOEGANKELIJK`: toegankelijkheid per perron van bus, tram en metro uit het Centraal Haltebestand, met vertrekken per perron, gegenereerd door `scripts/bouw_toegankelijkheid.py` |
| `data/ruimtebeslag.js` | `const RUIMTEBESLAG`: parkeren ÷ openbare ruimte per subbuurt(deel), gegenereerd door `scripts/bouw_ruimtebeslag.py` |
| `js/app.js` | overzicht: oordeel per waarde, tabellen, kerncijfers; elk blok in een `veilig()`-guard |
| `js/thema.js` | themaviewers: kaarten, tabellen, schuifjes en uurprofiel; tabellen boven 8 rijen klappen in. In de OV-viewer opent een gekozen buurt een buurtkaart met al zijn cijfers |
| `js/ov-normen.js` | frequentie en haltedekking bij een instelbare norm, gedeeld door overzicht en OV-viewer |
| `js/review.js` | reviewmodus, alleen geladen met `?review=1` |

## Echte cijfers bijwerken

`data/datalade.js` komt uit twee vastgepinde, openbare checkouts. De commit van elke bron staat
in de uitvoer en onderaan elke themaviewer.

```bash
git clone --depth 1 https://github.com/WKSu/prototype-overschie ../wksu/prototype-overschie
git clone --depth 1 https://github.com/WKSu/loopbaarheid-ov ../wksu/loopbaarheid-ov
uv run scripts/bouw_datalade.py --datalade ../wksu/prototype-overschie \
    --loopbaarheid ../wksu/loopbaarheid-ov/index.html \
    --gtfs data_manual/gtfs/NL-20260922.gtfs.zip
uv run scripts/bouw_ovkaart.py --datalade ../wksu/prototype-overschie \
    --loopbaarheid ../wksu/loopbaarheid-ov/index.html     # na bouw_datalade.py
```

Met `--gtfs` rekent het script het uurprofiel (vertrekken per uur) uit op de dag van de verkenner,
dinsdag 22 september 2026, zodat het op dezelfde dienstregeling rust als de cijfers per adres. De
feed `NL-20260922.gtfs.zip` (NDOV/OVapi) staat in `data_manual/gtfs/`. De feed moet die dag
dekken: een feed met nul of minder dan de helft van de vertrekken van de datalade wordt geweigerd,
want dan ontbreekt een vervoerder. `--peildatum` kiest ter controle een andere dag.

Zonder `--gtfs` komt het uurprofiel uit de datalade, op de dinsdag waarop die gebouwd is
(11 augustus 2026, in de zomervakantie, en zonder RET-buslijnen 30, 31, 35, 36 en 96–98); de
viewer zegt het dan. Is de feed niet bij de hand, dan neemt `--uurprofiel-van data/datalade.js`
het uurprofiel over uit de vorige build, maar alleen als die met een feed op de dag van de
verkenner is gemaakt; anders breekt het script af.

Het script schrijft alleen aggregaten per gebied, buurt, sector of halte; nooit een adres.
Hernoemt een bron een veld, dan breekt het script af in plaats van een lege tabel te maken.
Daarna: `uvx ruff format scripts/ && uvx ruff check scripts/`.

### Frequentie en haltedekking (OV)

Beide zijn instelbaar in de OV-viewer. `scripts/bouw_datalade.py` schrijft daarom geen cijfer bij
één drempel, maar per buurt twee verdelingen van woonadressen: naar de beste frequentie op
loopafstand per dagdeel (in stappen van 0,5 per uur per richting), en naar de loopafstand tot
bus/tram en metro/trein (stappen van 50 en 100 m). `js/ov-normen.js` telt die bij elke stand van de
schuifjes exact op; het overzicht gebruikt dezelfde rekenregel bij de standaardnorm uit
`FUNCTIONEREN.ovKeuzes` (avond, 4 per uur; 500 m bus/tram, 800 m metro/trein). De onderbouwing
van de loopafstanden staat in `docs/loopafstanden.md`.

De frequentie heeft een tweede telling: **lijnen op één traject samen**. Lijnen die vanaf de
halte 1 of 2 km dezelfde route rijden (halverwege en aan het eind nog geen 150 m uit elkaar),
tellen op; per buurt staat daarvan een eigen verdeling (`bedieningTraject`), per halte en
overstappunt de hoogste som. De viewer schakelt ertussen; het overzicht blijft op de beste lijn.
Onderbouwing en uitkomsten in `docs/frequentie-meerdere-lijnen.md`.

### Meerzijdige bereikbaarheid (OV)

Drie maten per woonadres, opgeteld per buurt en gebied: de **vervoersmix** (minstens twee soorten
OV op loopafstand), de **richting-check** (een lijn op loopafstand die niet door gebied Rotterdam
Centrum rijdt) en de **storingstest** (wie geen bruikbaar OV overhoudt als de kwetsbaarste
corridor uitvalt). Loopafstand: 500 m naar bus en tram (de bron heeft per halte alleen
adreslijsten tot 500 m), 800 m naar metro en trein. Een lijn telt mee bij minstens 2 vertrekken
per uur per richting in het dal. Een corridor is een lijn met de lijnen van dezelfde vervoerwijze
die de helft van zijn haltes delen. Alle drempels staan bovenaan `scripts/bouw_datalade.py`.
Het bereik binnen 30 minuten vraagt een reisplanner en banen per locatie; die zijn er nog niet.

### OV-kaarten uitleggen

Elke OV-kaart toont eerst de uitkomst per buurt; wie wil weten waar die vandaan komt, schakelt een
laag bij. Frequentie en haltedekking hebben een laag **loopgebied van de haltes**: wat binnen
loopafstand ligt van een halte die de norm haalt. De loopgebieden van 500 m (1 km rond de grote
knopen) komen uit de verkenner; die van 800 m rond metro- en treinstations berekent
`scripts/bouw_ovkaart.py` over hetzelfde looproutenetwerk, met 30 m aan weerszijden van de route
(geijkt met `--ijk`: dan vallen de eigen 500 m-gebieden samen met die van de bron). Het blijft een
benadering van de meting per adres: ongeveer 98% van de woningen die meetellen ligt erin, en aan de
randen ook ongeveer 1 op de 10 die net niet meetellen. Bij een andere loopafstand dan 500/800 m
toont de haltedekking daarom alleen de buurten.

De richting-check tekent de bruikbare lijnen, doorgetrokken als ze om het centrum heen rijden, en
gebied Rotterdam Centrum zelf. De storingstest heeft een kiezer: zet een verbinding op zwart en de
kaart toont wie dan zonder bruikbaar OV zit. De groepen worden daarvoor over het hele rayon gevormd;
het verlies per gebied is gelijk aan dat in de tabel per gebied. Een gekozen buurt (klik, of de
kiezer bovenaan) geldt voor alle kaarten en opent een buurtkaart met de cijfers bij de huidige
instellingen en de lijnen op loopafstand, met hun vertrekken per dagdeel.

### Toegankelijke perrons (OV)

```bash
uv run scripts/bouw_toegankelijkheid.py     # na bouw_datalade.py
```

Per perron (quay) van bus, tram en metro het oordeel van het Centraal Haltebestand (CHB): toegankelijk
bij een motorische beperking en bij een visuele beperking, met perronhoogte en geleidelijn. De
dagelijkse export staat op <https://data.ndovloket.nl/haltes/> (open data, DOVA); zet
`ExportCHB_<datum>.xml.gz` in `data_manual/chb/`, het script neemt de nieuwste. Een perron telt alleen
mee als er op de peildatum van de viewer iets vertrekt, volgens dezelfde GTFS-feed als het
uurprofiel. Een GTFS-halte hoort bij het dichtstbijzijnde CHB-perron van dezelfde soort: binnen 25 m
voor bus en tram (een bus kan aan een tramperron stoppen), binnen 150 m en één op één voor de metro,
want de punten liggen op verschillende plekken langs het lange perron. Vindt meer dan 2% van de
vertrekken in het rayon geen perron, dan breekt het script af.

Kader: *Beleidskader Toegankelijk Openbaar Vervoer* (MRDH, 2024), in
`data_manual/beleidskader toegankelijk ov/`. Het noemt geen percentage, alleen het streven naar volledig
toegankelijk OV in 2040, en geeft de drukst gebruikte haltes voorrang. De indicator heeft daarom geen
norm; de viewer zet de perrons op aantal vertrekken. Treinperrons (ProRail) staan niet in het CHB.

## Fiets bijwerken

```bash
uv run scripts/bouw_fiets.py     # data_manual/fiets, na bouw_datalade.py
```

De levering van het themateam Fiets (oktober 2026, bij de notitie *Thematische indicatoren* van
20 oktober 2026) staat in `data_manual/fiets`:

- **Netwerkkaart fiets** op het NWB (`Fietsnetwerk_NoordBuitenRing.gpkg`), per wegvak primair,
  secundair of tertiair. `new_*` is een schakel die er nog niet ligt; stukjes binnen 5 m van elkaar
  zijn één schakel, met de straatnamen van het dichtstbijzijnde wegvak aan elk eind.
- **Mazen** van het befietsbare OSM-netwerk (`OSM_NoordBuitenRing_Fiets_mazen.gpkg`). Maaswijdte =
  omtrek ÷ 4, de zijde van een vierkant met dezelfde omtrek. De levering toetste de omtrek aan 1000 m
  ('500 + 500'), maar `omtrek_m` is de hele rand: twee zijden van 500 m horen bij een omtrek van
  2000 m. De afspraak (500 m) staat in `FUNCTIONEREN.fietsKeuzes`; in de viewer is de grens in te
  stellen, en op 250 m zie je de uitkomst van de levering. Mazen onder 125 m gaan niet mee.
- **VRI's** uit de lijst VRI-vervangingen van januari 2023 (`VRIs_NoordBuitenRing.gpkg`). Een VRI
  telt binnen 25 m van een route van de netwerkkaart; de stopkans is VRI's per 10 km netwerkkaart.
  De levering deelde alle 33 door alle 786 km weg in het rayon.

Normen: maaswijdte boven 500 m, ontbrekende schakels en breedtelabel onder B zijn rood, als afspraak
van het themateam. De breedtelabels zitten nog niet in de levering.

## Parkeertellingen bijwerken

`data/parkeerdruk.js` komt uit de handmatige levering in `data_manual/parkeerdruk/data`: de zips
van de parkeertellingen (Excel per subbuurtdeel), en de shapefiles `Subbuurtdelen` en
`parkeersectoren`. Een nieuwe telling is een nieuwe zip met de naam
`Parkeertelling <gebied> (<projectcode>).zip`.

```bash
uv run scripts/bouw_parkeerdruk.py
```

Maatgevend is de werkdagnacht (ma–vr, start tussen 23 en 5 uur); bij meer nachten het
gemiddelde. Een ander moment kan per telling in `MAATGEVEND_ANDERS` (Spaanse Polder, bedrijventerrein:
dinsdagmiddag); zonder beide staat de telling op de kaart, maar telt niet mee. Zijn er twee tellingen in één subbuurtdeel, dan telt de
recentste met een werkdagnacht. De Spaanse Polder (gebied 18, buiten het rayon) staat in de
analyse, niet in de gebiedscijfers van het overzicht (`EXTRA` in het script). Het script
schrijft alleen aggregaten per subbuurtdeel, subbuurt en sector, en breekt af als een veld
ontbreekt of een subbuurtdeel een andere buurtnaam heeft dan de shapefile.

## Rapportcijfer, fietsparkeren en ruimtebeslag bijwerken

```bash
uv run scripts/bouw_rapportcijfer.py     # data_manual/rapportcijfer parkeren/*.xlsx, blad Resultaat
uv run scripts/bouw_fietsparkeren.py     # data_manual/fietsparkeertellingen/*.zip (Ecorys)
uv run scripts/bouw_woningbouw.py        # data_manual/BoPro/BoPro_openbaar.gpkg
uv run scripts/haal_npr.py               # P+R-capaciteit uit het NPR (open data, RDW)
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
