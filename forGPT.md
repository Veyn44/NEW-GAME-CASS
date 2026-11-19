# forGPT.md

> Krátký pracovní kontext pro pokračování projektu. Udržovat vždy pod 100 řádků.

## Projekt
- Cassandra je hlavní hra; Engine je aplikačně neutrální; Dev Lab je samostatná vývojová/testovací dílna.
- Závislosti: Dev Lab → Engine, Cassandra → Engine. Engine nikdy nezávisí na aplikacích.
- Dev Lab smí mít přípravné/diagnostické funkce, které ve hře nebudou; herní mechaniky ale musí používat skutečné sdílené Engine systémy.
- Dev Lab může připravovat mise, spawnovat entity, testovat a ukládat scénáře. Cassandra je musí umět spustit.
- Formáty: Cassandra .cass, samostatný Dev Lab .dlcass; aplikace sdílejí Engine a Dev Lab načítá Cassandra content definitions + potřebné Unit/Colony gameplay systémy, nikoli campaign/expedition runtime.
- GitHub Pages má jeden launcher (index.html) a samostatné vstupy game.html a dev-lab.html; cílem je jediný Dev Lab workspace v dev-lab.html.

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
- Standalone Dev Lab používá Engine Core/spatial + Cassandra Unit a Colony Control gameplay systémy; existující gameplay controller zajišťuje F = Draft, leader Johny a WASD Pawn movement, zatímco Draft off ovládá free camera. Cassandra campaign/expedition systémy se do Dev Lab runtime nepřidávají.
- V audited tree nebyly nalezeny combat, inventory/item gameplay systémy, map/encounter generator ani mission/scenario system.
- Cassandra Campaign/expedition má lifecycle/projection foundations, nikoliv hotový player-facing campaign gameplay.
- Aktuální main CI po merge #8: Core/Host i Pages workflows úspěšné na merge commitu 267336e9e2ef28730a9a3a247b7ebe1e38a933e7; CI není důkaz kompletní browser/gameplay acceptance.
- První výřez Phase 4 je sjednocení Dev Labu. Zachovat původní funkční gameplay (Johny spawn, automatický leader, F/Draft, WASD Pawn control, free camera, pause, camera follow, Unit inspector/profile, .dlcass). Standalone Dev Lab načítá Cassandra content definitions a používá existující Cassandra Unit/Colony gameplay adaptéry; nevytvářet placeholder Engine entity adapter ani falešné API. Nevyžádané Spatial Inspector/test entities odstranit z UI i obsluhy, Engine Spatial API zachovat. Starý workspace v `game.html` odstranit až po ověření jediného standalone Dev Labu.

## Lighting — první implementační výřez (2026-11-19)
- Schváleno: světla jsou runtime-only (varianta A); Cassandra obnovuje zdroje z vlastních herních definic. Engine je nepřidává do Persistence.
- Jediný model útlumu: kvadratický. `innerRadius` drží blízkou oblast jasnou, mezi ním a `radius` platí `(1-t)^2`, na vnějším radius je intenzita nulová. Pro baterku je orientační počáteční innerRadius 8 polí; nejde o pevnou konstantu enginu.
- Implementováno v `engine/lighting/lighting-system.js`: world-scoped point lights, validace, add/update/remove/list/get a výpočet osvětlení s host `occlusionQuery`; Core Assembly publikuje `core.lighting`.
- První grid occlusion je synchronní supercover line trace přes host callback; kontroluje oba sousední buňky při průchodu rohem, aby světlo neprotékalo diagonální spárou. Engine neinterpretuje kategorie jako wall/door. Aktuálně pouze `point`; Spot/Area/Ambient, Canvas a Dev Lab inspector nejsou hotové.
- Testy v `tests/unit/lighting-system.test.js`; nutno ověřit CI po posledním commitu a dále zlepšit/testovat chování paprsků u diagonálních rohů. Veškerá práce pouze na `phase4`, `main` beze změn.

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
- Cassandra `game.html` má návratový odkaz do Pages launcheru. Starý schválený Dev Lab workspace v `game.html` je výchozí UI reference; při dokončení samostatného Dev Labu se z herní aplikace odstraní, ne pouze skryje.
- Uživatel výslovně odmítl nevyžádané Dev Lab funkce (Spatial Inspector, Spawn Test Entity, Move Selected, Remove Test, Test Footprint a jejich obsluhu). Odstranit je z UI i implementace, nikoli skrýt. Engine Spatial API zůstává v Engine.
- Samostatný Dev Lab musí zachovat původní schválené UI/HUD, skutečné Cassandra definice a plnohodnotné Unit/Colony gameplay chování. `dev-lab-content-controller.js` byl placeholder a je odstraněn; spawn jde přes existující Unit API. Nepřidávat funkce bez konkrétní společně potvrzené potřeby.
- Ověření po Pages deploy: Dev Lab → Database → Johny → Spawn; F toggles Draft; WASD moves Johny while drafted and free camera otherwise; camera follow + Unit inspector; Space/Esc; Save As/export .dlcass. Cassandra campaign/expedition runtime remains outside Dev Lab.
- Core/Host CI na phase4 po změnách úspěšné. Pages preview workflow je záměrně ponechán na větvi work; pokus o deploy z phase4 skončil před spuštěním runneru (žádné kroky/job logy), takže Pages smoke test z této větve zatím nelze potvrdit. Neprovádět změny GitHub Pages environment nastavení bez domluvy.

## Údržba tohoto souboru
- Po každé větší dokončené části práce aktualizovat tento soubor: zapsat pouze nové trvalé poznatky, rozhodnutí, důležité změny stavu a otevřené návaznosti.
- Při každém zápisu celý dokument znovu zkomprimovat: slučovat opakování, odstraňovat zastaralé informace a ponechat jen kontext potřebný pro další práci.
- Nikdy nepřekročit 100 řádků; cílit výrazně níže. Nezapisovat průběžný šum ani kompletní historii commitů.
