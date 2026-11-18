# forGPT.md

> Krátký pracovní kontext pro pokračování projektu. Udržovat vždy pod 100 řádků.

## Projekt
- Cassandra je hlavní hra; Engine je aplikačně neutrální; Dev Lab je samostatná vývojová/testovací dílna.
- Závislosti: Dev Lab → Engine, Cassandra → Engine. Engine nikdy nezávisí na aplikacích.
- Dev Lab smí mít přípravné/diagnostické funkce, které ve hře nebudou; herní mechaniky ale musí používat skutečné sdílené Engine systémy.
- Dev Lab může připravovat mise, spawnovat entity, testovat a ukládat scénáře. Cassandra je musí umět spustit.
- Formáty: Cassandra .cass, samostatný Dev Lab .dlcass; obě aplikace sdílejí Engine, nikoli herní DB/runtime.
- GitHub Pages má mít jeden launcher (index.html) a samostatné vstupy game.html a dev-lab.html; Dev Lab musí fungovat bez Cassandra shellu a DB.

## Phase 4 — aktuální záměr
- Otevřená, experimentální fáze: budovat základní herní mechaniky a současně jimi rozvíjet/ověřovat Engine.
- Pracovat po malých, viditelných a spustitelných výřezech; průběžně testovat v Dev Labu i Cassandře.
- Možné náměty (ne závazky): základní mapa, případně map/encounter generator, první entity/databázové definice, pohyb/interakce, základy boje a inventáře, grafické testy.
- Grafika má nejprve ověřit práci Engine s assety, vizuální reprezentací, vrstvami a animací; finální styl není předem určen.
- Další kroky a pořadí se rozhodují podle výsledků a společné domluvy. Nevyplňovat otevřený plán vlastními předpoklady.
- Podrobnější, stále nezávazný rámec: whattodo.md.

## Main audit — připravenost pro první výřez (2026-11-16)
- Připravené základy: grid worlds 64/128/256, spatial occupancy/footprints/queries, entity registry, placement coordinator, unit create/move/remove/persistence, WASD přímé ovládání Johnyho, definition registry/package loader/catalog, camera/zoom/selection, .cass save/load.
- Cassandra má jedinou skutečnou content definici pawn.johny; artwork je null. Cassandra umí jednotku vybrat z katalogu, umístit na mapu a zobrazit jako marker; pohyb a ukládání jsou implementované.
- Renderer: sdílený Canvas 2D viewport pro grid/kameru/markery/highlight/placement preview. Placement preview umí načíst jednotlivý obrázek; obecný asset manager, entity sprite renderer, animation pipeline ani render layers nejsou implementované.
- Dev Lab standalone používá Engine Core/spatial a umí vytvářet/měnit/inspektovat pouze dočasné spatial test entities. Default runtime neobsahuje Cassandra gameplay/content. Existují injection seams pro content loader a runtime factory, ale mission/scenario editor ani game-content integration nejsou hotové.
- V audited tree nebyly nalezeny combat, inventory/item gameplay systémy, map/encounter generator ani mission/scenario system.
- Cassandra Campaign/expedition má lifecycle/projection foundations, nikoliv hotový player-facing campaign gameplay.
- Aktuální main CI po merge #8: Core/Host i Pages workflows úspěšné na merge commitu 267336e9e2ef28730a9a3a247b7ebe1e38a933e7; CI není důkaz kompletní browser/gameplay acceptance.
- Kandidát na první viditelný výřez: propojit skutečnou definici jednotky → map placement → vizuální asset → pohyb → .cass save/load. Nejdřív společně vybrat, zda první test hostovat v Cassandra workspace nebo rozšířit Dev Lab composition; žádná implementace zatím nezačala.

## Pevné pracovní zásady
- Neimplementovat další etapu ani zásadní směr bez společné dohody.
- Nemergovat PR, neměnit main, nemazat větve ani neprovádět destruktivní Git akce bez výslovného souhlasu.
- Zachovat všechny zálohy a historické větve.
- Otestovanou environment simulation neměnit bez konkrétního důvodu a samostatného souhlasu.
- Nezavádět paralelní implementace Engine systémů v Dev Labu nebo Cassandře.
- Upřednostnit funkční ověřitelný výsledek před abstraktní infrastrukturou bez bezprostředního použití.

## Stav větví
- main obsahuje merge Phase 3 (#7) a dokumentační konsolidaci (#8).
- Pracovní větev phase4 vychází z aktuálního main; neprovádět merge bez souhlasu.
- První implementační krok: rozdělení Pages launcheru a vstupů aplikací. game.html je Cassandra aplikace (původní index); dev-lab.html je standalone Engine Dev Lab. Root index nabízí výběr obou.
- Cassandra stránka má odkaz do samostatného dev-lab.html; její legacy workspace UI zůstává v shellu, ale není cílem samostatného Dev Labu.
- Ověření po Pages deploy: game.html → Save As/export .cass; dev-lab.html → Save As/export .dlcass; potvrdit, že Dev Lab běží bez Cassandra DB/runtime. Samotné oddělení URL ani koncovka souboru samy o sobě nedokazují úplnou nezávislost runtime.
- Core/Host CI na phase4 po změnách úspěšné. Pages preview workflow je záměrně ponechán na větvi work; pokus o deploy z phase4 skončil před spuštěním runneru (žádné kroky/job logy), takže Pages smoke test z této větve zatím nelze potvrdit. Neprovádět změny GitHub Pages environment nastavení bez domluvy.

## Údržba tohoto souboru
- Po každé větší dokončené části práce aktualizovat tento soubor: zapsat pouze nové trvalé poznatky, rozhodnutí, důležité změny stavu a otevřené návaznosti.
- Při každém zápisu celý dokument znovu zkomprimovat: slučovat opakování, odstraňovat zastaralé informace a ponechat jen kontext potřebný pro další práci.
- Nikdy nepřekročit 100 řádků; cílit výrazně níže. Nezapisovat průběžný šum ani kompletní historii commitů.
