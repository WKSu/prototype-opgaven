# Functioneren en opgaven · prototype

Statische viewer over hoe het mobiliteitssysteem functioneert per gebied, en waar dat tekortschiet
ten opzichte van een norm. Vervolglaag op [`rayonplannen`](https://github.com/WKSu/rayonplannen);
de achtergrond staat in `docs/overdracht-functioneren-en-opgaven.md`.

Openen: dubbelklik `index.html`. Geen buildstap, werkt onder `file://`.

## Opbouw

| Bestand | Wat |
|---|---|
| `index.html` | opmaak en vaste tekst; kleurtokens gelijk aan `rayonplannen` |
| `data/indicatoren.js` | `const FUNCTIONEREN`: gebieden, normen en indicatoren met waarden per gebied |
| `js/app.js` | oordeel per waarde, tabellen, kerncijfers; elk blok in een `veilig()`-guard |

## Lagen

1. **Nu:** rayon Noord buiten de Ring, Parkeren en OV, met **fictieve waarden**.
2. `data/indicatoren.js` genereren uit een vastgepinde snapshot van `rayonplannen`
   (`ov.js`, `intern.js`), met bron en peildatum per cijfer.
3. Deeplinks terug naar `rayonplannen` op gebiedscode.
4. Opgaven als registry: alleen bij een norm met een aanwijsbaar document.

## Regels

- Rood alleen uit een norm in `FUNCTIONEREN.normen`, met een `document`. Zonder norm: alleen tonen.
- `null` is onbekend, geen 0. Een ontbrekend cijfer blijft zichtbaar, ook met de normenlaag uit.
- Geen rayontotaal als ongewogen gemiddelde van gebieden.
- Gebiedscodes overnemen uit `rayonplannen/data/index.js`, niet met de hand typen.
