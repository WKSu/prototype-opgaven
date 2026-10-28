# Welke loop- en fietsafstand naar het OV vinden mensen aanvaardbaar?

Verkenning voor de standaardnormen van de haltedekking en de frequentie in de OV-viewer
(28 oktober 2026). De gekozen waarden staan in `data/indicatoren.js` (`ovKeuzes`) en zijn in de
viewer met schuifjes aan te passen. Geen van de waarden hieronder is een vastgestelde norm van
de gemeente Rotterdam of de MRDH.

**Over de bronnen.** Een deel van de bronnen kon ik in deze omgeving niet openen
(`cvs-congres.nl`, `ovmagazine.nl` en `rotterdamraad.bestuurlijkeinformatie.nl` zijn geblokkeerd).
Die cijfers komen uit de samenvatting van een zoekresultaat en zijn gemarkeerd met *(niet zelf
ingezien)*. Controleer ze voordat ze in een advies komen.

## Kort antwoord

1. **Bus en tram: 500 m lopen.** De gangbare norm is 400 m *hemelsbreed*. Over het
   looproutenetwerk is dat ongeveer 500 m: de omrijfactor in de datalade is 1,23 tot 1,32. Gemeten
   loopafstanden liggen in dezelfde orde: mediaan 380 m naar de tram in Den Haag, en 85% van de
   looptochten naar de bus in Montreal korter dan 524 m.
2. **Metro en trein: 800 m lopen.** Dat is aan de voorzichtige kant. De conventie is 800 m
   hemelsbreed (ongeveer 1.000 m lopen), de MRDH acht 600 tot 800 m aanvaardbaar voor snel en
   frequent OV *(niet zelf ingezien)*, en in Montreal is 85% van de looptochten naar de trein korter
   dan 1.259 m. De frequentie en de meerzijdige bereikbaarheid rekenen ook met 800 m.
3. **Ouderen en mensen die slecht ter been zijn: 200 tot 300 m.** Dat is een variant om met het
   schuifje te verkennen, geen standaard.
4. **Fiets: ongeveer 3 km naar een trein- of metrostation, ongeveer 1 km naar de tram.** De
   viewer rekent dit nog niet uit: daarvoor zijn afstanden over het fietsnetwerk nodig.
5. **Een harde grens bestaat niet.** Het gebruik van OV neemt geleidelijk af met de afstand. Een
   drempel is een keuze om een aandeel te kunnen tellen, geen kantelpunt in gedrag.

## Hemelsbreed of over het netwerk

De meeste normen zijn hemelsbreed gemeten. De verkenner `loopbaarheid-ov` meet over het
looproutenetwerk (OSM). Die twee zijn niet uitwisselbaar: dezelfde 400 m is over het netwerk
langer. De datalade meet de omrijfactor over het fietsnetwerk, voor afstanden van 300 tot 1.500 m
hemelsbreed (`data/<gebied>/infra.js` in `prototype-overschie`):

| Gebied | Zelfde kant van de snelweg | Over de snelweg |
|---|---:|---:|
| Overschie | 1,32 | 1,42 |
| Hillegersberg-Schiebroek | 1,23 | 1,52 |
| Prins Alexander | geen meting | geen meting |

Het looproutenetwerk is vaak fijnmaziger dan het fietsnetwerk, dus voor lopen ligt de factor
eerder aan de lage kant. 400 m hemelsbreed is dan 490 tot 530 m lopen. Daarom is 500 m lopen de
standaard voor bus en tram. Waar een snelweg of spoor tussen woning en halte ligt, is het effect
groter; dat ziet een hemelsbrede norm niet, en de netwerkafstand wel.

## Lopen naar de halte

| Bron | Wat | Waarde |
|---|---|---|
| Vervoerregio Amsterdam *(niet zelf ingezien)* | norm, hemelsbreed | 400 m naar ontsluitend OV, 800 m naar HOV; sinds 2013 moet minstens 90% van de adressen in aangewezen gebieden daarbinnen liggen. In de streekconcessies 1.200 m naar een NS-station. |
| MRDH, via een raadsantwoord Rotterdam *(niet zelf ingezien)* | standpunt | 600 tot 800 m aanvaardbaar bij snel en frequent OV; reizigers accepteren dan tot 1.000 m. |
| CROW, via een gemeentelijk antwoord en een CVS-paper *(niet zelf ingezien)* | richtlijn | 450 m hemelsbreed naar een bushalte; 350 m voor de lokale bus in de bebouwde kom. Invloedsgebied bus en tram 400 tot 500 m, metro 700 tot 1.000 m. |
| Rijsman, Van Oort e.a., TU Delft (Den Haag, tram) | gemeten | mediaan 380 m lopen en 1.025 m fietsen naar de halte; loopafstand weegt 2,1 keer zo zwaar als fietsafstand; fietsenstalling vergroot het fietsbereik met 234 m. |
| El-Geneidy e.a. 2014 (Montreal) | gemeten, 85e percentiel | 524 m naar de bus, 1.259 m naar de trein, vanaf huis. |
| Perth, *Myths and realities in walkable catchments* | gemeten | 400 of 800 m als loopgebied van een station is "op zijn best simplistisch en kan sterk misleiden". |
| Keijer en Rietveld 2000 (Nederland, trein) | gemeten | wie 500 tot 1.000 m van een station woont, gebruikt de trein ongeveer 20% minder dan wie binnen 500 m woont; tussen 1,0 en 3,5 km is het verschil ongeveer 30%. |

**Ouderen.** In een Australisch onderzoek onder 100 thuiswonende ouderen was de gewenste afstand
tot de bushalte 200 m of minder; de auteurs zetten dat af tegen de gangbare 400 m. Een Zweeds
onderzoek onder 2.398 mensen van 75 tot 90 jaar laat zien dat ouderen, vrouwen, alleenwonenden en
mensen met een slechtere gezondheid de afstand tot de halte overschatten. Wie ze vraagt, hoort
dus een langere afstand dan er is.

## Fietsen naar de halte

| Bron | Waarde |
|---|---|
| KiM 2018, *Waar zouden we zijn zonder de fiets en de trein?* *(niet zelf ingezien)* | woning tot gekozen station gemiddeld 2,4 km hemelsbreed, ongeveer 3,4 km fietsen; 1 tot 3 km hemelsbreed is gangbaar; de e-fiets kan de trein bereikbaar maken voor wie verder dan 3,5 km woont. |
| Rijsman, Van Oort e.a., TU Delft (Den Haag, tram) | mediaan 1.025 m fietsen naar de tramhalte; fietsers gaan tot 3 km in de stad. |
| TU Delft, afstudeeronderzoek *(niet zelf ingezien)* | gewone fiets gemiddeld ongeveer 3,5 km per rit, e-fiets ongeveer 5 km (ritten in het algemeen, niet naar de halte). |

De datalade heeft al een fietsdrempel: in `rayonplannen` staat het aandeel inwoners binnen 5 km van
een treinstation als "fietsafstand" (98,7% in dit rayon). Dat is gerekend op het buurtgemiddelde
van de CBS-nabijheid, dus grof. Een fietsdekking per adres vraagt afstanden over het fietsnetwerk;
de verkenner `loopbaarheid-ov` stopt bij 2 km lopen.

## Wat dit betekent voor de viewer

- De standaard voor de haltedekking gaat van 400 naar **500 m lopen** voor bus en tram. Met 400 m
  over het netwerk was de norm strenger dan de 400 m hemelsbreed waar hij op lijkt.
- De schuifjes hebben ijkpunten op 300, 400, 500 en 600 m (bus en tram) en 800, 1.000 en 1.200 m
  (metro en trein).
- Frequentie en meerzijdige bereikbaarheid rekenen vast met 500 en 800 m: de bron heeft per halte
  alleen adreslijsten tot 500 m. Bij de standaardnorm rekenen alle OV-indicatoren dus met
  dezelfde afstanden.

## Open

- **Een vastgestelde norm.** Vraag de MRDH welke loopafstand en frequentie ze in de concessie of
  het vervoerplan hanteren, en of de gemeente daarvan wil afwijken. Tot die tijd blijft dit een
  keuze die in de viewer zichtbaar is.
- **Een afstandsverval in plaats van een drempel.** Een gewogen maat (een halte op 300 m telt
  zwaarder dan een op 700 m) past beter bij het gedrag, maar is moeilijker uit te leggen.
- **Fietsdekking.** Afstanden over het fietsnetwerk naar metro- en treinstations, met de
  stallingscapaciteit uit de fietsparkeertellingen erbij.

## Bronnen

- [Vervoerregio Amsterdam, bestuurlijke informatie](https://vervoerregio.bestuurlijkeinformatie.nl/Document/View/ec6c1c37-f977-4286-84d9-a65c76943924) *(niet zelf ingezien)*
- [Gemeenteraad Rotterdam, raadsantwoord over tramhaltes](https://rotterdamraad.bestuurlijkeinformatie.nl/Document/View/18058d89-c100-4192-a52e-423826c1382f) *(niet zelf ingezien)*
- [CVS-congres 2010, paper 043](https://www.cvs-congres.nl/cvspdfdocs/cvs10_043.pdf) *(niet zelf ingezien)*
- [Rijsman, Van Oort e.a., *Walking and bicycle catchment areas of tram stops*](https://nielsvanoort.weblog.tudelft.nl/1059-2/)
- [El-Geneidy e.a., *New evidence on walking distances to transit stops*](https://www.worldtransitresearch.info/research/5119)
- [*Myths and realities in walkable catchments: the case of walking and transit*](https://trid.trb.org/View/665133)
- [Keijer en Rietveld, *How do people get to the railway station? The Dutch experience*](https://swov.nl/en/publicatie/how-do-people-get-railway-station-dutch-experience)
- [*Developing guidelines for age-friendly buses*](https://research.usc.edu.au/esploro/outputs/journalArticle/Developing-guidelines-for-age-friendly-buses-a/99450508602621)
- [*How far is the closest bus stop?* (Geomatics, 2023)](https://doaj.org/article/677db5110fdc48e2ae4f55cb99a78cdb)
- [KiM, *Waar zouden we zijn zonder de fiets en de trein?*, uitgebreide samenvatting](https://www.ovmagazine.nl/wp-content/uploads/2018/06/Waarzoudenwezijnzonderdefietsendetrein_uitgebreidesamenvatting.pdf) *(niet zelf ingezien)*
- [TU Delft, afstudeeronderzoek fiets en e-fiets](https://repository.tudelft.nl/file/File_13c152e5-c8fb-4e36-ab8c-fa8fee714d84) *(niet zelf ingezien)*
