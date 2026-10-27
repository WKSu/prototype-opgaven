# Vervolglaag "functioneren en opgaven" — overdracht

Opgesteld 27 oktober 2026, op basis van `main` @ `e4e877f`. Bedoeld voor de agent of
ontwikkelaar die de nieuwe viewer bouwt. Dit is een verkenning van wat er ligt en wat er nog
besloten moet worden. Het is geen ontwerp, en de opdrachtgever heeft er nog niets over besloten.

## 1. In één alinea

`rayonplannen` beschrijft per gebied **wat er is**: wie er woont, welk aanbod er ligt en hoe
mensen reizen. Alles staat er neutraal in, met bron, peiljaar en aggregatieniveau. De nieuwe laag
gaat over **hoe goed het mobiliteitssysteem werkt** (functioneren) en **waar dat tekortschiet ten
opzichte van een gewenste situatie** (opgaven). Dat tweede deel is per definitie interpretatie.
Dat is de belangrijkste reden om er een aparte viewer van te maken: zo blijft `rayonplannen`
neutraal, en de nieuwe laag mag oordelen, mits elk oordeel gelabeld is en terug te voeren op een
feit in `rayonplannen`. De twee producten delen het gebiedsmodel en de gebiedscodes, en linken
op die codes naar elkaar.

## 2. Waar de nieuwe laag in de redeneerketen zit

Issue [#65](https://github.com/WKSu/rayonplannen/issues/65) beschrijft de redeneerketen van een
adviseur, van cijfer naar opgave. Zo verdeelt die keten zich over de twee producten:

| Stap | Vraag | `rayonplannen` | Nieuwe laag |
|---|---|---|---|
| 1. Feit | wat is gemeten, uit welke bron, welk peiljaar | ja | hergebruikt, linkt terug |
| 2. Referentie | vergeleken waarmee | ja (referentielaag, #7/#48) | hergebruikt |
| 3. Afwijking | hoe bijzonder is het verschil | ja, beschrijvend (signaleringsoverzicht, #67) | uitbreiden naar functioneringsmaten |
| 4. Wie het raakt | hoeveel mensen, welke groep, waar | deels (drempelaandelen, #50) | uitbreiden |
| 5. Mechanisme | waarom is het zo | deels (barrières, omrijfactor) | **kern van "functioneren"** |
| 6. Handelingsruimte | kan de gemeente er iets aan doen | bewust niet | **kern van "opgaven"** |
| 7. Weging | is het erg genoeg om opgave te heten | bewust niet (#30) | **kern van "opgaven"**, alleen met een vastgestelde norm |

De nieuwe laag bouwt dus voort op stap 3 tot en met 7. Stap 1 en 2 bouwt hij niet opnieuw.

## 3. Werkdefinities (voorstel, nog te bevestigen)

- **Functioneren**: hoe het systeem de vraag afwikkelt. Dat is waar vraag en aanbod elkaar raken,
  per modaliteit: intensiteit tegenover capaciteit, bezetting, vertraging, betrouwbaarheid,
  bereikbaarheid als reistijd en verkeersveiligheid. Daarnaast de effecten op de omgeving
  (lucht, geluid, barrièrewerking). `rayonplannen` toont nu vraag (ODiN, autobezit) en aanbod
  (netwerk, dienstregeling) **los van elkaar**. Waar ze elkaar raken, ontbreekt
  ([#103](https://github.com/WKSu/rayonplannen/issues/103)).
- **Signaal**: een beschrijvende afwijking ten opzichte van vergelijkbare gebieden, zonder
  oordeel. Dit kan nu al, met de rekenregel van #67.
- **Opgave**: een spanning tussen een feit of functioneringsmaat en een **vastgestelde** gewenste
  situatie (#65). Zonder aanwijsbare norm of doel is iets geen opgave, hooguit een signaal.

Het onderscheid tussen signaal en opgave is het belangrijkste ontwerpprincipe dat ik meegeef. Met
signalen kan de viewer al iets zinnigs laten zien voordat er een normenkader is. Daarnaast
voorkomt het onderscheid dat de viewer zelf normen gaat verzinnen.

## 4. Wat er ligt om op te bouwen

### 4.1 Gebiedsmodel: hergebruiken, niet nabouwen

- **Bron van waarheid**: `scripts/regios.py` (netwerkvrij, importeerbaar). Hierarchie:
  gemeente `GM0599` → vier rayons (`RAYON_NOORD_BUITEN`, `RAYON_NOORD_BINNEN`,
  `RAYON_ZUID_BINNEN`, `RAYON_KLEINE_KERNEN`) → veertien gebieden (= CBS-wijken `WK0599xx`) →
  buurten.
- **Rotterdam heeft 22 CBS-wijken, niet 14.** Acht haven-, bedrijven- en watergebieden vallen
  buiten de rayons (`regios.NIET_GEBIED`). Het gemeentetotaal is daardoor groter dan de som
  van de rayons: circa 3.040 inwoners, vrijwel allemaal in Nieuw Mathenesse. Voor functioneren
  weegt dit zwaarder dan voor de bevolkingscijfers: de havengebieden hebben bijna geen
  inwoners, maar wel veel verkeer.
- WK-codes worden **op naam** geresolveerd (`regios.resolve()`), zodat een CBS-herindeling luid
  faalt. Neem dat over.
- **Gebruik in de nieuwe viewer exact dezelfde codes.** Dan is koppelen triviaal (zie §5).

### 4.2 Data als interface

Alle gegenereerde data staat in `data/` als `.js` met één globale `const`. Er is bewust geen JSON,
want het dashboard moet onder `file://` werken. Na `const NAAM = ` staat zuivere JSON. Dat is
gecontroleerd voor `data/index.js`, `data/referentie.js` en alle bestanden van `WK059904`. In
Python lees je zo'n bestand dus met
`re.search(r"^const (\w+) = (.*);\s*$", tekst, re.M | re.S)` en daarna `json.loads`.

| Bestand | `const` | Wat erin zit | Bruikbaar voor de nieuwe laag |
|---|---|---|---|
| `data/index.js` | `GEBIEDEN` | gebiedsboom (`gemeente`, `rayons[].gebieden[]`, `buitenGebiedsindeling`), `normen`, `elementen` (inventaris met status), `viewers` (met deeplink per gebiedscode) | gebiedskiezer, normen, overzicht van wat ontbreekt |
| `data/referentie.js` | `REFERENTIE` | per gebiedscode (19 stuks): `naam`, `niveau`, `inwoners`, `indicatoren{waarde, volledig, nOnderdrukt, peiljaar}`, `verdelingen`, `groei`, `reeksen`, `zelfvoorzienend`, `odin` | vergelijking tussen gebieden **zonder** de volledige gebiedsdata te laden |
| `data/<code>/profiel.js` | `PROFIEL` | KWB-kerncijfers, tijdreeksen sinds 2013, buurtvergelijking met aggregatie-info | context, noemers (inwoners, huishoudens) |
| `data/<code>/cbs_mobiliteit.js` | `CBSMOB` | nabijheid (incl. drempelaandelen), auto's per huishouden, modal split per provincie | bereikbaarheid als afstand |
| `data/<code>/odin_wijk.js` | `ODINW` | modal split, motieven, afstand × vervoerwijze, bestemmingen, dagdelen, bezoekers (n ≥ 20) | **de vraagkant** |
| `data/<code>/ov.js` | `OV` | lijnen, haltes, ritten per dag, vertrekken per uur (één doordeweekse dag uit GTFS) | **het geplande OV-aanbod** |
| `data/<code>/infra.js` | `INFRA` | fietsnet, km vrijliggend fietspad, km weg per klasse, snelwegkruisingen, omrijfactor | aanbod fiets, barrièrewerking |
| `data/<code>/ongevallen.js` | `ONGEVALLEN` | BRON per jaar en afloop, hotspotraster van 100 m, punten | verkeersveiligheid |
| `data/<code>/voorzieningen.js` | `VOORZ` | OSM-voorzieningen in vijf categorieën | bestemmingen (gebouwd voor 9 van de 19 gebieden) |
| `data/<code>/segmenten.js` | `SEGMENTEN` | SES-WOA per wijk en buurt | wie het raakt |
| `data/<code>/geo.js` | `GEO` | buurtpolygonen, gebiedscode, -naam en -niveau | kaarten |
| `data/<code>/intern.js` | `INTERN` | geaggregeerd uit niet-openbare leveringen: autobezit per subbuurt, vestigingen, **parkeersectoren (vergunningen, wachtlijst, bezetting)**, Wijkprofiel-indices | parkeerdruk, de bestaande gemeentelijke indices |

Elk blok heeft `bron`, `peildatum`, `niveau` en meestal een `caveat`. Neem die velden
ongewijzigd over in alles wat de nieuwe laag toont. `volledig: false` met `nOnderdrukt > 0`
betekent een **ondergrens**, geen lager cijfer, en `null` betekent onbekend, geen 0.

Gecommit zijn `GM0599`, de vier rayons en de veertien gebieden. De acht havenwijken staan in
`.gitignore` en bestaan alleen lokaal. `data/gebouwd.js` is lokaal en ontbreekt in een verse
clone.

Bouwen vraagt `scripts/cache/` (circa 1,5 GB, deels niet herdistribueerbaar). **Een CI-runner
of een nieuwe repo kan deze data dus niet zelf bouwen**: lees de gecommitte bestanden.

### 4.3 Per thema: wat er is en wat ontbreekt

| Thema | Er is | Ontbreekt (issue) |
|---|---|---|
| OV | gepland aanbod (`ov.js`), loopbaarheid per halte (verkenner `loopbaarheid-ov`) | bediening per tijdvenster [#101](https://github.com/WKSu/rayonplannen/issues/101); BTM-haltes en onbediende woonvlekken [#95](https://github.com/WKSu/rayonplannen/issues/95); punctualiteit en rituitval [#99](https://github.com/WKSu/rayonplannen/issues/99); bezetting (niet open) [#103](https://github.com/WKSu/rayonplannen/issues/103) |
| Auto | geschatte intensiteit per wegvak (verkenner `intensiteitenkaart`, TomTom Move, geen telling); autobezit (KWB en intern); parkeercapaciteit (verkenner) en sectorbezetting (intern) | I/C en vertraging t.o.v. free flow [#103](https://github.com/WKSu/rayonplannen/issues/103); lussen en VRI [#28](https://github.com/WKSu/rayonplannen/issues/28) |
| Fiets | netwerk, km vrijliggend, kruisingen, omrijfactor (`infra.js`) | tellingen [#28](https://github.com/WKSu/rayonplannen/issues/28); I/C fiets [#103](https://github.com/WKSu/rayonplannen/issues/103); ontbrekend aanbod [#104](https://github.com/WKSu/rayonplannen/issues/104) |
| Lopen | nabijheid als drempelaandeel | voetpaden (OSM is hier onbetrouwbaar, BGT onderzoeken) [#104](https://github.com/WKSu/rayonplannen/issues/104) |
| Bereikbaarheid | afstand over de weg (CBS-nabijheid) | reistijd tegen een norm, *Bereikbaarheid op Peil* [#102](https://github.com/WKSu/rayonplannen/issues/102) |
| Vraag | ODiN (modal split, motief, afstand, dagdeel, bestemming, zelfvoorzienendheid), pendel (verkenner `daily-urban-systems`) | ketens en activiteitenpatronen [#25](https://github.com/WKSu/rayonplannen/issues/25) |
| Veiligheid | BRON-ongevallen 2022–2024, raster van 100 m, afloop | weging naar ernst (bewust niet gedaan); blootstellingsnoemer |
| Leefbaarheid | NO₂ en PM2,5 (RIVM-WMS) met wettelijke en WHO-normen | geluid [#19](https://github.com/WKSu/rayonplannen/issues/19) |
| Doelgroepen | SES-WOA | zelfredzaamheid en beweegbeperking [#24](https://github.com/WKSu/rayonplannen/issues/24) |

De conclusie die je hieruit trekt is ongemakkelijk. Bijna alles wat functioneren in strikte zin
meet (I/C, vertraging, bezetting, punctualiteit, tellingen) bestaat nog niet in `rayonplannen`,
en de meeste kandidaatbronnen zijn niet open of geen meting. Zie §6.

### 4.4 Rekenregels en registries om over te nemen

- `scripts/aggregatie.py`: `SOM`, `GEWOGEN`, `NIET_AGGREGEERBAAR`, de CBS-onderdrukkingscodes
  (`-99997`, `-99995`, `.`) en `valideer(..., verklaard=...)`. Het bestand werkt zonder netwerk
  en is direct te importeren.
- `scripts/indicatoren.py`:
  - `INDICATOREN`: de vorm van één entry per indicator, met aggregatieregel en verplichte noemer.
    De registry weigert een gewogen gemiddelde zonder noemer. Kopieer dat principe.
  - `DREMPELS`: drempelafstanden voor nabijheid, uitdrukkelijk als **keuze** vastgelegd.
  - `NORMEN`: **de kiem van een normenkader.** Op dit moment alleen NO₂ en PM2,5, met per norm
    `waarde`, `eenheid`, `richting`, `soort` (`wettelijk` of `advies`), `naam`, `bron` en
    `peiljaar`. De afspraak uit #30 staat in het commentaar: *alleen een wettelijke of
    vastgestelde norm, nooit het gemeentegemiddelde*.
- `scripts/bronnen_intern.py`: een niet-openbare bron zonder `voorwaarden` en `n_min` wordt
  geweigerd. Neem dit één-op-één over voor V-MRDH, VRI-data en dergelijke.
- **De ODiN-drempel**: geen getoonde uitkomst op minder dan 20 respondenten. Wat eronder valt,
  blijft leeg en wordt niet samengevoegd.
- **Drempelaandeel boven gemiddelde**: "aandeel inwoners binnen X", geen gemiddelde afstand.
  Voor functioneren wordt dat "aandeel netwerk-km met I/C > x in de ochtendspits", niet een
  gemiddelde I/C over een rayon (#103).

### 4.5 Wat al richting opgaven wijst

- **Signaleringsoverzicht (#67)**, `js/app.js`, blok `veilig("signalering")`. De rekenregel is
  (eigen waarde − mediaan van de peers) / (max − min van de peers). Peers zijn alle gebieden op
  hetzelfde niveau (`peersOpNiveau(() => true, false)`), met minstens drie peers. De uitkomst is
  beschrijvend: "buiten de spreiding", zonder kleur. Dit is stap 3 van de keten, en de nieuwe
  laag kan hem uitbreiden naar functioneringsmaten.
- **Peer-logica**: `peersOpNiveau()` en `referentiekandidaten()` in `js/app.js`. Vergelijk
  binnen een niveau en nooit tussen niveaus, anders presenteer je een omvangseffect als
  verschil.
- **Feitenblad (#68)**: het gebied als citeerbare platte tekst met bronregel per cijfer. Een
  opgavenlaag heeft hetzelfde nodig: een opgave moet in een gebiedsplan terechtkomen met de
  onderbouwing erbij.
- **Reviewmodus** (`?review=1`, `js/review.js`): reviewers kunnen per kaart vrij invullen
  **"Raakt welke opgave?"**. Het commentaar in `review.js` noemt een toekomstig
  `js/opgaven.js` dat uit die woordenschat gevuld kan worden. Die opmerkingen staan in de
  localStorage van de reviewers en in hun JSON-exports, **niet in de repo**. Vraag de
  gebruiker om die exports: ze vormen de empirische startlijst van opgaven, in de woorden van de
  projectgroep.
- **Duiding** (`js/teksten.js`, sectie 09): de enige plek met interpretatie, en alleen voor
  Overschie ingevuld. Wat daar staat ("Leefbaarheid en mobiliteit zijn hier één dossier",
  "Autogeoriënteerd door ligging") zijn hypothesen die naar de nieuwe laag kunnen verhuizen.
- **Wijkprofiel Rotterdam** (`INTERN.bronnen.wijkprofiel`): de Sociale, Fysieke en
  Veiligheidsindex per gebied, 2014–2026. Dit is de gemeentelijke maat die het dichtst bij een
  bestaand opgavenkader ligt. Er bestaat geen rayonscore.

## 5. Het koppelcontract

### 5.1 Van `rayonplannen` naar de nieuwe viewer

Een viewer toevoegen is **één entry in `scripts/viewers.py`**. De frontend leest die uit
`data/index.js` en rendert er een kaart van. Er hoeft niets in `js/app.js` te veranderen.

- Verplichte velden: `sleutel`, `naam`, `omschrijving`, `url` (**https**, want een http-iframe
  wordt onder `file://` stil geblokkeerd), `sectie`, `bron`, `niveau`, `modus`, `caveat`.
  Optionele velden: `kunnen` (lijst met zinnen), `ankers` (`data-onderwerp`-sleutels waar een
  regel "Meer details" onder komt), `voorbeeld` (een lokaal beeld in `assets/viewers/`, dat moet
  bestaan), `peiljaar`, `verversing`.
- `modus`: `FACADE` laadt pas een iframe na een klik en vereist `hoogte`. `LINK` toont alleen
  een verwijzing.
- `sectie`: elk element-id uit `index.html` werkt (`plekVoor()`). Voor een overkoepelende laag
  liggen `s1` ("01 · Het gebied", waar het signaleringsoverzicht en de zelfvoorzienendheid
  staan) of `s6` (duiding) meer voor de hand dan een mobiliteitssubsectie. Dat is een
  redactionele keuze voor de opdrachtgever.
- **Deeplink per gebied**: voeg een functie toe aan `_DEEPLINKS` die per gebiedscode
  `(hash, selectielabel)` oplevert. Als de nieuwe viewer `#gebied=<code>` accepteert met
  **dezelfde codes**, is die functie één regel en kan hij niet stil verkeerd linken.
  Vergelijk dat met `parkeercapaciteit`: dat product linkt op een volgnummer in plaats van een
  code, `viewers.py` noemt dat zelf een structurele fout, en er is een aparte netwerkcontrole
  (`scripts/check_viewers.py`) voor nodig. Maak die fout niet opnieuw.
- `controleer()` valideert de registry bij elke run. `data/index.js` wordt herschreven door
  **elke** run van `bouw_data.py` (`schrijf_index()`, dat PDOK nodig heeft).

### 5.2 Van de nieuwe viewer naar `rayonplannen`

```
<basis>/index.html#gebied=<code>&naar=<element-id>&vergelijk=<code>,<code>
<basis>/index.html?review=1#gebied=<code>          (reviewmodus staat in de query, niet in de hash)
```

- `<basis>` heb ik niet kunnen verifiëren. De README spreekt van GitHub Pages; vermoedelijk is
  het `https://wksu.github.io/rayonplannen/`, maar die host was vanuit deze omgeving niet
  bereikbaar. Controleer dit.
- `gebied`: een van de 19 gecommitte codes. Staat `GEBOUWD` lokaal en ontbreekt het gebied
  daarin, dan valt `laad.js` terug op `WK059904`. Link dus nooit naar een havenwijk.
- `naar`: een **element-id**, opgezocht met `getElementById`. Bruikbaar zijn `s0`, `s1`, `s1b`,
  `s2`, `s3`, `s4`, `s5`, `s5-nabijheid`, `s5-ov`, `s5-fiets`, `s5-verkeer`, `s5-veiligheid`,
  `s5-auto`, `s5c`, `s5b`, `s6` en `datastatusKop`. **Let op: de id's lopen niet gelijk met de
  getoonde nummers.** `s0` is de hero, `s1` = 01 Het gebied, `s1b` = 02 Binnen het gebied,
  `s2` = 03 Bevolking, `s3` = 04 Sociaal-economisch, `s4` = 05 Wonen, `s5` = 06 Mobiliteit,
  `s5c` = 07 Verplaatsingspatronen, `s5b` = 08 Voorzieningen, `s6` = 09 Duiding.
- `vergelijk`: komma-gescheiden gebiedscodes voor de referentielaag. Een leeg veld betekent
  bewust geen vergelijking.
- **Er bestaat nog geen deeplink naar één grafiek of indicator.** De stabiele ankers zijn de
  `data-onderwerp`-sleutels (100 stuks, zie `scripts/onderwerpen.txt`, bijvoorbeeld
  `kaart-ongevallen` en `grafiek-spits`). `laad.js` zoekt `naar` echter alleen op id. Een
  kleine uitbreiding in `js/laad.js` lost dat op: val terug op
  `[data-onderwerp="<waarde>"]`. Daarmee kan elke opgave linken naar precies het cijfer waar
  hij op rust. Dit is werk in **deze** repo en hoort in een eigen issue.

### 5.3 Data overnemen

Er zijn drie opties:

1. **Bij runtime laden van de gepubliceerde site** (`<script src="<basis>/data/referentie.js">`).
   Technisch kan het, want een scripttag kent geen CORS. Maar de viewer werkt dan niet offline
   of onder `file://`, en hij breekt stil zodra `rayonplannen` een veld hernoemt.
2. **Een snapshot tijdens het bouwen** (aanbevolen). Het bouwscript van de nieuwe viewer leest
   de gecommitte `data/*.js` van een vastgepinde commit van `rayonplannen`, bijvoorbeeld via een
   git-submodule of een sparse checkout. Leg die commit-SHA en de `peildatum` vast in de
   eigen uitvoer. Zo is elke opgave te herleiden tot een vaste versie van de feiten.
3. **De Python-registries importeren** (`regios.py`, `aggregatie.py`, en zo nodig
   `indicatoren.py`) via dezelfde submodule in plaats van te kopiëren. Een kopie loopt uit de
   pas bij de eerste CBS-herindeling.

Optie 2 en 3 gaan goed samen. Toets in de nieuwe repo met een controle in de stijl van
`scripts/check_referentielaag.js` dat de verwachte velden er nog zijn. Ook hier geldt: een
ontbrekend veld moet luid falen en mag niet als een lege grafiek verschijnen.

## 6. Regels: wat meegaat en wat opnieuw besloten moet worden

**Gaat ongewijzigd mee:**

- Elk getoond cijfer heeft een bron, een peiljaar en een aggregatieniveau.
- Een onderdrukte of ontbrekende waarde is geen 0, en geen meting is geen rustige weg.
- Geen ongewogen gemiddelden over buurten of wijken.
- Een drempelaandeel gaat voor een gemiddelde.
- Een ODiN-uitkomst rust op minstens 20 respondenten.
- `scripts/cache/` en `bronnen/intern/` worden nooit gecommit. Uit interne bronnen komen alleen
  aggregaten boven `n_min`. Geen microdata, adressen of vrije tekst in output, commits of
  issues.
- Statisch, zonder buildstap, werkend onder `file://`, met blokken in een `veilig()`-guard.
  Chart.js 4.4.1 en Leaflet 1.9.4 zijn lokaal meegeleverd, met PDOK BRT grijs als ondergrond.
  De kleurtokens staan in `index.html` (`--asfalt`, `--schie`, `--polder`, `--markering`,
  `--rood`, …). Hergebruik ze, zodat beide viewers als één familie lezen.
- De conventies: Nederlandse namen en commentaar dat het *waarom* uitlegt, PEP 723-scripts met
  `uv run`, en `ruff`.

**Moet opnieuw besloten worden, door de opdrachtgever en niet door een agent:**

1. **Het normenkader.** Welke doelen of normen gelden per thema, en wie heeft ze vastgesteld?
   `NORMEN` bevat nu alleen luchtkwaliteit. Zonder aanwijsbare bron blijft de opgavenlaag leeg,
   of hij verzint normen. Het tweede is erger. Vraag ook of de opdrachtgever normen uit
   vastgesteld gemeentelijk beleid wil gebruiken en welke documenten dat zijn. Verzin ze niet
   uit algemene kennis.
2. **De bronregel.** `rayonplannen` gebruikt alleen open bronnen die jaarlijks verschijnen.
   Functioneren draait juist op bronnen die daar niet onder vallen: V-MRDH (een model), TomTom
   (commercieel, geschat), lussen en VRI's (intern), OV-bezetting (niet open). Er is één
   precedent: de intensiteitenkaart staat als losse verkenner op TomTom-data. Leg per bron
   expliciet vast of hij toegestaan is, en label **model** en **meting** altijd zichtbaar
   verschillend.
3. **De ruimtelijke eenheid.** Functioneren bestaat op wegvak-, halte- en corridorniveau, en
   opgaven lopen vaak over rayongrenzen heen (de Ring, de A13/A20, de Maasoeververbindingen).
   Het gebied is daarvoor eerder een **filter** dan de eenheid van analyse. Waar wel naar een
   gebied wordt geaggregeerd, gebeurt dat alleen als drempelaandeel. Gemeentelijke bronnen
   publiceren daarnaast vaak per **stadsdeel**, en die indeling snijdt de rayonindeling (zie
   `onderzoek/27-omnibusenquete.md`).
4. **De gebruiker.** Een gebiedsplan-adviseur die onderbouwing zoekt vraagt een andere viewer
   dan een bestuurder die prioriteiten wil zien. Dat bepaalt of de laag een naslagwerk wordt of
   een rangorde.

## 7. Valkuilen

- **`CLAUDE.md` zegt "`js/*.js` zijn gegenereerd", maar dat klopt niet meer.** In de praktijk
  zijn `js/app.js`, `js/laad.js`, `js/review.js` en `js/teksten.js` handgeschreven en worden ze
  in PR's met de hand bewerkt (zie `git log -- js/app.js`). Gegenereerd is `data/`. De README
  klopt op dit punt.
- **Peiljaren lopen uiteen.** Een opgave die verschillende bronnen combineert, combineert ook
  verschillende jaren. Voor Overschie: ODiN 2022–2023, BRON 2022–2024, de GTFS-feed van één dag
  in augustus 2026, en KWB per blok de nieuwste gevulde jaargang. Zet bij een samengestelde
  uitspraak alle peiljaren erbij.
- **De noemer van een functioneringsmaat is een keuze.** Ongevallen per inwoner rekent het
  doorgaande verkeer op de A13 toe aan de bewoners van Overschie. Per voertuigkilometer is
  eerlijker, maar daarvoor ontbreekt een open bron. Leg de keuze vast in een registry, zoals
  `DREMPELS`.
- **Referenties buiten profiel en ODiN.** `referentie.js` dekt geen OV, ongevallen,
  voorzieningen of drempelaandelen ([#88](https://github.com/WKSu/rayonplannen/issues/88)).
  Wie die maten tussen gebieden wil vergelijken, moet wachten op #88 of leest de
  gebiedsbestanden zelf. Dat kan, want alle 19 staan gecommit.
- **Ongevallen zijn ongewogen.** Een dodelijk ongeval telt even zwaar als blikschade. Weging
  naar ernst is een normatieve keuze, en die hoort dus in de nieuwe laag thuis, gelabeld.
- **`voorzieningen` is voor 9 van de 19 gebieden gebouwd.** Een bestemmingsgerichte
  bereikbaarheidsmaat die hierop leunt, mist dan de helft.
- **Een groot product insluiten** maakt het dashboard traag. Kies `FACADE` of `LINK` en
  voeg een lokaal voorbeeldbeeld toe.

## 8. Voorgestelde eerste stappen

1. **Leg de vier besluiten uit §6 voor** voordat er code komt. Vraag ook om de
   review-exports met het veld "Raakt welke opgave?".
2. **Zet een nieuwe repo op met dezelfde architectuur**: statisch, onder `file://` werkend,
   `.js`-consts, `veilig()`, een PEP 723-bouwscript en `rayonplannen` als vastgepinde submodule.
3. **Bouw eerst wat zonder nieuwe besluiten kan**: een functioneringsprofiel per gebied uit
   bestaande data (OV-bediening, verkeersveiligheid, barrièrewerking, nabijheid als
   drempelaandeel, zelfvoorzienendheid, parkeerbezetting per sector), met per maat de signalen
   volgens de regel van #67. Elke regel linkt terug naar `rayonplannen`.
4. **Leg opgaven vast als registry, net als `indicatoren.py`**, en laat die registry weigeren
   wat geen opgave is. Een schets, met plaatshouders en zonder echte normen:

   ```python
   OPGAVEN: list[dict] = [
       {
           "sleutel": "...",
           "naam": "...",
           "thema": "veiligheid",            # ov | auto | fiets | lopen | bereikbaarheid | ...
           "maat": "...",                    # sleutel van een functioneringsmaat
           "eenheid": "wegvak",              # wegvak | halte | corridor | buurt | gebied
           "norm": {
               "waarde": ...,
               "richting": "boven",
               "soort": "vastgesteld",       # wettelijk | vastgesteld | advies
               "vastgesteld_door": "...",    # leeg -> geweigerd: dan is het een signaal
               "document": "...",
               "peiljaar": "...",
           },
           "onderbouwing": ["kaart-ongevallen"],  # data-onderwerp-sleutels in rayonplannen
       },
   ]
   ```

   Zonder `vastgesteld_door` hoort de regel niet in `OPGAVEN` maar is het een signaal. Zo werkt
   ook de bestaande weigering van een gewogen gemiddelde zonder noemer.
5. **In deze repo, als losse issues**: de entry in `viewers.py` met een deeplink op gebiedscode
   (§5.1), en `naar=` laten terugvallen op `data-onderwerp` (§5.2).

## 9. Relevante issues

| Issue | Waarover | Status |
|---|---|---|
| [#65](https://github.com/WKSu/rayonplannen/issues/65) | van cijfers naar opgaven: de redeneerketen | open (epic) |
| [#45](https://github.com/WKSu/rayonplannen/issues/45) | van portret naar vergelijkingsinstrument | open (p0) |
| [#30](https://github.com/WKSu/rayonplannen/issues/30) | normatieve duiding: alleen een vastgestelde norm | gesloten, uitgewerkt in `NORMEN` |
| [#7](https://github.com/WKSu/rayonplannen/issues/7), [#88](https://github.com/WKSu/rayonplannen/issues/88) | vergelijken tussen gebieden, referenties buiten profiel en ODiN | open |
| [#103](https://github.com/WKSu/rayonplannen/issues/103) | vraag en aanbod: I/C, bezetting, vertraging | open (onderzoek) |
| [#102](https://github.com/WKSu/rayonplannen/issues/102) | Bereikbaarheid op Peil: reistijd tegen een norm | open (onderzoek) |
| [#99](https://github.com/WKSu/rayonplannen/issues/99) | OV-betrouwbaarheid | open (onderzoek) |
| [#104](https://github.com/WKSu/rayonplannen/issues/104) | ontbrekend aanbod voor lopen, fiets en auto | open (onderzoek) |
| [#28](https://github.com/WKSu/rayonplannen/issues/28) | tellingen en snelheden (lussen, VRI) | open (onderzoek) |
| [#95](https://github.com/WKSu/rayonplannen/issues/95), [#101](https://github.com/WKSu/rayonplannen/issues/101) | OV-bediening en onbediende woonvlekken | open |
| [#19](https://github.com/WKSu/rayonplannen/issues/19), [#24](https://github.com/WKSu/rayonplannen/issues/24), [#25](https://github.com/WKSu/rayonplannen/issues/25) | geluid, doelgroepen, ketens | open |
