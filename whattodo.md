# Phase 4 — What to do

## Záměr

Postupně položit základ skutečných herních mechanik Cassandry a současně rozvíjet a ověřovat Engine na jejich reálných potřebách.

Phase 4 je otevřená, experimentální a iterativní etapa. Tento dokument je pouze orientační mapa, nikoliv závazná specifikace, pořadník úkolů ani definitivní rozsah práce. Konkrétní kroky a priority vyplynou z průběžných výsledků a společných rozhodnutí.

## Způsob práce

- Vybírat malé, konkrétní a spustitelné herní výřezy.
- Mechaniky průběžně vytvářet a testovat v Dev Labu.
- Dev Lab může mít vývojové, diagnostické a přípravné funkce, které v samotné hře nikdy nebudou.
- Dev Lab a Cassandra mají používat stejné skutečné Engine systémy; Dev Lab nemá vytvářet paralelní implementace herních mechanik.
- Výsledky ověřovat také přímo v Cassandře, včetně spuštění herních scénářů.
- Podle zkušeností upravovat směr i rozsah další práce. Nedokončený nápad není automaticky závazkem.

## Možné oblasti k prozkoumání

Následující body jsou příklady a náměty, nikoliv povinný seznam:

- základní herní mapa a práce se světem;
- případně generování map nebo encounterů;
- první herní entity a jejich definice v databázi;
- základní pohyb, interakce a další chování entit;
- první jednoduché bojové mechaniky, ze kterých může postupně vyrůst combat systém;
- základy inventáře a práce s předměty;
- první funkční grafické zobrazení herních entit a prostředí.

Pořadí, výběr i výsledná podoba těchto oblastí zůstávají otevřené.

## Dev Lab a scénáře

Dev Lab má umožňovat připravovat a volně upravovat testovací situace: vytvářet mise, vkládat nebo spawnovat entity a objekty, zkoušet mechaniky a ukládat připravené scénáře.

- Dev Lab může používat vlastní vývojové funkce, které nejsou součástí hry.
- Podle potřeby lze scénáře ukládat jako `.dlcass` pro Dev Lab nebo jako `.cass` pro Cassandru.
- Pro Pages-hosted verzi Cassandry je zatím dostačující ukládání a načítání `.cass`.
- Připravené scénáře mají být možné spustit také přímo ve hře.

## Grafika a assety

Cílem prvních grafických pokusů není rozhodnout o finálním vizuálním stylu Cassandry. Skutečné assety mají především pomoci ověřit, jak Engine pracuje s vizuální reprezentací entit, načítáním assetů, vrstvami, animacemi a vykreslováním.

Konkrétní grafický styl, formáty a pracovní postup se mohou vyvíjet podle toho, co při praktických testech funguje a co se nám vizuálně osvědčí.

## Hranice a opatrnost

- Zachovat oddělení odpovědností: Engine zůstává aplikačně neutrální, Cassandra vlastní herní pravidla a Dev Lab je vývojové/testovací prostředí.
- Zachovat směr závislostí: Dev Lab → Engine a Cassandra → Engine.
- Otestovanou environment simulation neměnit bez konkrétního důvodu a samostatného schválení.
- Změny průběžně testovat a ověřovat; stabilní `main` aktualizovat až po samostatné kontrole a schválení.

---

**Hlavní princip:** Nejdříve vytvořit něco malého, skutečně funkčního a viditelného. Zkušenosti z toho použít k rozhodnutí, co má následovat a jaké schopnosti má Engine skutečně potřebovat.
