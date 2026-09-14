# Verze 2.0 AUTO — časový model směny pro Výkon a OEE

Tato specifikace je součástí větve `Verze-2.0-Auto`.

## Pracovní doba

Kalendářní směna trvá 8 hodin. Uprostřed směny je 30minutová pauza, takže čistá pracovní směna je 7 hodin 30 minut.

Navíc se z výrobního času pro normu odečítá:

- 7 minut na začátku směny — příprava linky,
- 5 minut na konci směny — úklid linky.

Standardní výrobní čas pro normu je tedy:

**8:00 − 0:30 − 0:07 − 0:05 = 7:18 = 438 minut.**

## Směny

| Směna | Čas směny | Pauza |
|---|---|---|
| Ranní | 06:00–14:00 | 10:40–11:10 |
| Odpolední | 14:00–22:00 | 18:00–18:30 |
| Noční | 22:00–06:00 | 02:00–02:30 |

U ranní směny pauza zasahuje dvě hodinové položky: z hodiny 10:00–11:00 se odečte 20 minut a z hodiny 11:00–12:00 10 minut.

## Výpočet hodinového Výkonu

Pro každou hodinovou položku se určí skutečný počet výrobních minut po odečtení přípravy, pauzy a úklidu.

**Výkon = Reálný výstup / (Norma ks/h × efektivní výrobní minuty / 60) × 100**

Poslední rozpracovaná hodina se při známém času screenshotu zkrátí na skutečný čas pořízení screenshotu.

## Výpočet OEE

**OEE = Výkon × Dostupnost × (Kapacita Product Profile / skutečný počet operátorů) / 100**

OEE ani Výkon nejsou uměle omezeny na 100 %.

## Směnové KPI

Hodinové Výkony, Dostupnosti a OEE se agregují s vahou odpovídající skutečným výrobním minutám. Tím se například 53minutová první hodina, 40minutová hodina před ranní pauzou nebo 5minutová rozpracovaná hodina nepovažují za plnou hodinu.

Kanonickým zdrojem výsledných KPI zůstává databázový přepočet `recalculate_import_item_kpis`. OCR hodnoty Výkonu a OEE nejsou autoritativním zdrojem výsledných KPI.
