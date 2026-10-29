# Frequentie bij meer lijnen: beste lijn of samen?

Verkenning voor de schakelaar bij *Frequentie van het OV* in de OV-viewer (29 oktober 2026). De
indicator telt per woning de lijn die het vaakst rijdt. Maar waar meer lijnen dezelfde kant op
gaan, wacht je in de praktijk korter. Hoe tel je dat mee, en hoe laat je het zien?

**Over de bronnen.** De pagina's zelf kon ik in deze omgeving niet openen (Wikipedia,
Human Transit, de TCQSM bij de National Academies). Wat hieronder staat, komt uit de
samenvattingen van zoekresultaten en is gemarkeerd met *(niet zelf ingezien)*. Controleer het
voordat het in een advies komt.

## Kort antwoord

1. **Tel lijnen alleen samen als ze hetzelfde traject rijden.** Voor een reis langs dat traject
   neem je de eerste die komt; lijnen naar verschillende kanten vervangen elkaar niet. Alle
   lijnen van een halte optellen overschat het aanbod.
2. **Laat beide zien.** De beste lijn is de ondergrens (wat je zeker hebt), samen op één traject
   de bovengrens (alleen waar als de ritten om en om rijden). De echte wachttijd ligt ertussen.
3. **De lengte van het gedeelde stuk is een keuze, en die maakt voor bussen veel uit.** Daarom
   is die in de viewer in te stellen: 2 km (standaard) of 1 km.
4. **Bij de standaardnorm verandert er niets.** Elk kwartier in de avond geeft met beide
   tellingen hetzelfde beeld. Het verschil zit in strengere normen en in de metro.

## Vier manieren om meer lijnen te tellen

| Manier | Wat het meet | Waar het voorkomt | Bezwaar |
|---|---|---|---|
| Beste lijn | de lijn die het vaakst rijdt | deze viewer (standaard) | negeert dat een tweede lijn op hetzelfde traject je wachttijd halveert |
| Samen op één traject | lijnen die dezelfde route rijden, opgeteld | *common lines* in vervoermodellen; frequente-netwerkkaarten | bovengrens: alleen waar als de ritten om en om rijden en je langs dat traject reist |
| Alle lijnen van de halte | alle vertrekken bij elkaar | veel toegankelijkheidsmaten per halte | lijnen naar verschillende kanten tellen alsof ze elkaar vervangen |
| Gewogen (PTAL) | beste lijn telt vol, de rest half | Londen (TfL), Manchester, Victoria | een index zonder eenheid; ‘elk kwartier’ is er niet meer in te lezen |

**Samen op één traject.** In vervoermodellen heet dit het *common lines*-probleem: wie op een
halte staat, neemt de eerste van de ‘aantrekkelijke’ lijnen naar zijn bestemming. Bij
willekeurige aankomsten is de verwachte wachttijd het omgekeerde van de opgetelde frequentie,
en de kans op een lijn is zijn aandeel daarin (Nguyen en Pallottino 1988; Spiess en Florian
1989) *(niet zelf ingezien)*. Voor een kaart geldt het voorbehoud van de frequente-netwerkkaarten:
twee lijnen die elk om het half uur rijden, geven alleen elk kwartier een vertrek als ze om en om
rijden. En een kort gedeeld stuk kan frequent zijn terwijl de rest van beide lijnen dat niet is
(Human Transit, discussies bij de kaarten van Vancouver en Seattle; *(niet zelf ingezien)*).
Vervoerders noemen het verschuiven van dienstregelingen op een gedeeld traject juist als manier
om de frequentie te verhogen (TheRide, *Service Standards*).

**Gewogen (PTAL).** Londen rekent per route een loop- en wachttijd om naar een
*equivalent doorstep frequency*. Per vervoerwijze telt de beste route volledig en elke andere
route voor de helft; de som wordt in klassen gezet (Wikipedia; PTAL-factsheet Victoria;
TfL-methode 2010, via Camden) *(niet zelf ingezien)*. Dat is een nette tussenweg, maar de uitkomst
is een index: ‘elk kwartier een vertrek’ is er niet meer in te lezen, en die zin is wat deze
viewer bij een norm wil kunnen zeggen.

**De TCQSM** (het Amerikaanse handboek voor kwaliteit van OV) behandelt frequentie per halte en
per corridor. Of en hoe het routes naar dezelfde bestemming samen telt, kon ik niet controleren:
de tekst was niet bereikbaar.

## Wat de viewer doet

- **Schakelaar *Beste lijn / Lijnen op één traject samen*.** De kaart, de tabel per buurt, de
  punten en het loopgebied volgen de keuze. Onder de kopcijfers staan altijd beide tellingen, zodat
  je de bandbreedte ziet.
- **Samen = dezelfde route.** Twee lijnen rijden samen als ze vanaf de halte halverwege en aan het
  eind van het gedeelde stuk nog geen 150 m uit elkaar liggen, in een van hun rijrichtingen. Een
  lijn telt ook altijd voor zichzelf, dus ‘samen’ komt nooit onder de beste lijn uit.
  Vervoerwijzen mogen samen (een tram en een metro op hetzelfde stuk).
- **Lengte: 2 km of 1 km.** Met 1 km tellen lijnen die kort samen rijden en dan uit elkaar gaan
  ook mee; dan loop je vaak beter. 2 km is de standaard; dezelfde afstand als de windrichting in
  de richting-check.
- **Alle lijnen samen** staat niet als telling in de viewer, maar is de grootte van de punten
  (overstappunten). In de hovertekst staan alle drie: beste lijn, samen op één traject, alle
  lijnen.
- **Het overzicht blijft op de beste lijn.** Dat is de indicator; de schakelaar is om te
  verkennen.

## Wat het uitmaakt (dienstregeling dinsdag 22 september 2026)

Aandeel woonadressen dat de grens haalt, beste lijn → samen op één traject:

| | Overschie | Hillegersberg-Schiebroek | Prins Alexander |
|---|---:|---:|---:|
| Avond, elk kwartier (standaard), 2 km | 2,5% → 2,5% | 18,4% → 18,4% | 73,0% → 73,0% |
| Avond, 6 per uur, 2 km | 0% → 0% | 0% → 0% | 0% → 30,2% |
| Avond, 6 per uur, 1 km | 0% → 0,1% | 0% → 2,8% | 0% → 30,2% |
| Dal, 6 per uur, 1 km | 2,5% → 39,8% | 18,4% → 18,4% | 73,0% → 73,0% |

- **Prins Alexander:** metro A, B en C rijden samen. Bij Capelsebrug is dat overdag 18 vertrekken
  per uur per richting (de beste lijn 6), bij Alexander, Oosterflank en Prinsenlaan 12 (A en B).
- **Overschie:** bus 32 en 40 rijden een kilometer samen en gaan dan uit elkaar (Abtsweg,
  Baanweg, 2e Hogenbanweg). Met 1 km komt overdag 40% van de woningen op 6 per uur, met 2 km
  niet.
- **Bij de standaardnorm** maakt het niets uit: wie een lijn heeft die elk kwartier rijdt, heeft
  die al; wie hem niet heeft, krijgt hem niet door op te tellen.

## Open

- **Om en om of niet.** Of twee lijnen op een gedeeld stuk echt om en om rijden, staat niet in
  de frequentie per dagdeel. Daarvoor zijn de vertrektijden per halte uit de dienstregeling
  nodig: het grootste gat tussen twee vertrekken zegt meer dan het gemiddelde.
- **Welke bestemming telt?** ‘Samen’ veronderstelt dat je langs het gedeelde stuk reist. Naar
  een metrostation of een knoop is dat aannemelijk; in het algemeen niet. Een maat per
  bestemming (bereik binnen 30 minuten) lost dat op en staat bij de indicatoren die nog
  ontbreken.

## Bronnen

- [Public transport accessibility level (Wikipedia)](https://en.wikipedia.org/wiki/Public_transport_accessibility_level) *(niet zelf ingezien)*
- [PTAL-factsheet, Victoria (december 2025)](https://www.planning.vic.gov.au/__data/assets/pdf_file/0033/762738/PTAL-Fact-Sheet-December-2025.pdf) *(niet zelf ingezien)*
- [TfL PTAL-methode 2010, via Camden](https://camdocs.camden.gov.uk/CMWebDrawer/Record/4813966/file/document) *(niet zelf ingezien)*
- [GMAL Calculation Guide, Transport for Greater Manchester](https://odata.tfgm.com/opendata/downloads/GMAL/GMAL%20Calculation%20Guide.pdf) *(niet zelf ingezien)*
- [Transit Capacity and Quality of Service Manual, 3e druk](https://nap.nationalacademies.org/read/24766/chapter/6) *(niet bereikbaar)*
- [Human Transit: some questions on frequent network mapping](https://humantransit.org/?p=21759) en [Vancouver publishes frequent network map](https://humantransit.org/?p=21667) *(niet zelf ingezien)*
- [TheRide, Service Standards: Design Principles](https://www.theride.org/sites/default/files/2026-03/ServiceStandards_Design_Principles.pdf) *(niet zelf ingezien)*
- [Spiess en Florian (1989), optimal strategies, toegelicht in de documentatie van tabenchmark](https://tabenchmark.readthedocs.io/en/latest/docs/design/adr-014-transit-strategy.html) *(niet zelf ingezien)*
- [Cepeda, Cominetti en Florian (2006), common lines in congested transit networks](https://repositorio.uchile.cl/handle/2250/124790) *(niet zelf ingezien)*
- [Staggered schedules op een gedeeld traject (McGill)](https://www.tram.mcgill.ca/Teaching/srp/documents/Nithya.pdf) *(niet zelf ingezien)*
