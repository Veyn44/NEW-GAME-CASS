# forGPT.md

> Krátký pracovní kontext pro pokračování projektu. Udržovat vždy pod 100 řádky.

## Projekt
- Cassandra je hlavní hra; Engine je aplikačně neutrální; Dev Lab je samostatná vývojová/testovací dílna.
- Závislosti: Dev Lab → Engine, Cassandra → Engine. Engine nikdy nezávisí na aplikacích.
- Dev Lab smí mít přípravné/diagnostické funkce, které ve hře nebudou; herní mechaniky ale musí používat skutečné sdílené Engine systémy.
- Dev Lab může připravovat mise, spawnovat entity, testovat a ukládat scénáře. Cassandra je musí umět spustit.
- Formáty: Cassandra `.cass`, Dev Lab `.dlcass`; Pages zatím potřebuje pouze `.cass`.

## Phase 4 — aktuální záměr
- Otevřená, experimentální fáze: budovat základní herní mechaniky a současně jimi rozvíjet/ověřovat Engine.
- Pracovat po malých, viditelných a spustitelných výřezech; průběžně testovat v Dev Labu i Cassandře.
- Možné náměty (ne závazky): základní mapa, případně map/encounter generator, první entity/databázové definice, pohyb/interakce, základy boje a inventáře, grafické testy.
- Grafika má nejprve ověřit práci Engine s assety, vizuální reprezentací, vrstvami a animací; finální styl není předem určen.
- Další kroky a pořadí se rozhodují podle výsledků a společné domluvy. Nevyplňovat otevřený plán vlastními předpoklady.
- Podrobnější, stále nezávazný rámec: `whattodo.md`.

## Pevné pracovní zásady
- Neimplementovat další etapu ani zásadní směr bez společné dohody.
- Nemergovat PR, neměnit `main`, nemazat větve ani neprovádět destruktivní Git akce bez výslovného souhlasu.
- Zachovat všechny zálohy a historické větve.
- Otestovanou environment simulation neměnit bez konkrétního důvodu a samostatného souhlasu.
- Nezavádět paralelní implementace Engine systémů v Dev Labu nebo Cassandře.
- Upřednostnit funkční ověřitelný výsledek před abstraktní infrastrukturou bez bezprostředního použití.

## Stav při zahájení Phase 4
- `main` obsahuje merge Phase 3 (#7) a následnou dokumentační konsolidaci (#8).
- Pracovní větev `phase4` byla založena z `main`; zatím obsahuje pouze otevřený rámec `whattodo.md`.
- Zatím nebyla zahájena implementace Phase 4. První konkrétní výřez ještě společně vybereme.

## Údržba tohoto souboru
- Po každé větší dokončené části práce aktualizovat tento soubor: zapsat pouze nové trvalé poznatky, rozhodnutí, důležité změny stavu a otevřené návaznosti.
- Při každém zápisu celý dokument znovu zkomprimovat: slučovat opakování, odstraňovat zastaralé informace a ponechat jen kontext potřebný pro další práci.
- Nikdy nepřekročit 100 řádků; cílit výrazně níže. Nezapisovat průběžný šum ani kompletní historii commitů.
