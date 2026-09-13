# Verze 2.0 AUTO — Koncept automatického importu výrobních screenshotů

> Tento dokument je závazná pracovní specifikace pro vývoj větve **2.0-AUTO**. Při implementaci se od něj nemáme odchylovat bez předchozí dohody.

## 1. Hromadný import screenshotů
- Uživatel může vybrat více screenshotů najednou.
- Systém je zpracuje automaticky jeden po druhém.
- Chybný screenshot nesmí zastavit zpracování ostatních.
- Po dokončení se zobrazí souhrn: úspěšně zpracované / ke schválení / chyby.

## 2. OCR zpracování
OCR rozpoznává dostupné údaje, zejména:
- datum,
- směnu,
- pracoviště/linku,
- produkt,
- normu,
- zaměstnance,
- pozici HA/TUP,
- OEE,
- výkon,
- dostupnost,
- hodinová data a další údaje potřebné pro výpočty.

OCR údaje jsou vždy pouze návrh, nikoli automaticky potvrzená pravda.

## 3. Editace OCR údajů
Všechny údaje předvyplněné OCR musí být před schválením editovatelné.

Platí to pro základní údaje i jednotlivé hodnoty, například datum, směnu, pracoviště, produkt, zaměstnance, normy, OEE, výkon, dostupnost a hodinové hodnoty.

Princip: **OCR pouze navrhuje hodnoty. Správce je může vždy opravit.**

## 4. Automatická validace
Proces:

**Screenshot → OCR → validace → automatické zpracování nebo Ke schválení**

Pokud je záznam bezpečně validní, může být zpracován automaticky. Pokud vznikne problém, záznam jde do **Ke schválení**.

## 5. Známý produkt
Pokud produkt existuje, má odpovídající Product Profile a potřebná data jsou validní, záznam může být automaticky zpracován.

## 6. Nový produkt
Pokud OCR rozpozná produkt, který systém nezná nebo nemá odpovídající Product Profile:
- záznam skončí v **Ke schválení**,
- správce vidí originální screenshot a OCR údaje,
- je k dispozici tlačítko **Vytvořit nový Product Profile**,
- otevře se modální okno pro vytvoření Product Profile,
- OCR předvyplněné údaje jsou všechny editovatelné,
- po vytvoření Product Profile je k dispozici tlačítko **Schválit**.

Samotné vytvoření Product Profile není totéž jako schválení výrobních dat.

## 7. Nerozpoznaný zaměstnanec
Pokud OCR nedokáže zaměstnance jednoznačně přiřadit, záznam skončí v **Ke schválení**.

Správce má dvě možnosti:

### A) Přiřadit stávajícího zaměstnance
- vyhledat zaměstnance,
- vybrat správného zaměstnance,
- přiřadit ho k čekajícímu záznamu.

### B) Vytvořit nového zaměstnance
- otevřít modální okno,
- nechat předvyplnit OCR údaje,
- všechny údaje umožnit upravit,
- vytvořit nového zaměstnance,
- nového zaměstnance následně přiřadit k čekajícímu záznamu.

Teprve poté může být záznam schválen.

Pokud je jméno velmi nejisté nebo nečitelné, systém nesmí vytvořit náhodného zaměstnance pouze na základě odhadu.

## 8. Screenshot u záznamů ke schválení
Každý záznam v **Ke schválení** musí mít dohledatelný originální screenshot, ze kterého vznikl.

Správce musí mít možnost:
- zobrazit náhled,
- otevřít screenshot ve větším zobrazení,
- porovnat screenshot s OCR údaji,
- podle screenshotu opravit údaje.

Screenshot je součástí auditní stopy.

## 9. Jeden screenshot, více problémů
Jeden screenshot může způsobit více problémů, například nový produkt i nerozpoznaného zaměstnance.

Originální screenshot se nemá zbytečně duplikovat; čekající položky/problémy mají být propojeny se stejným zdrojem.

Před schválením musí být vyřešeny všechny potřebné problémy.

## 10. Schválení
Tlačítko **Schválit** je dostupné pouze tehdy, když jsou vyřešeny všechny podmínky, například:
- produkt je známý nebo byl vytvořen Product Profile,
- zaměstnanec je jednoznačně přiřazen,
- povinné údaje jsou vyplněny,
- data jsou validní,
- případné OCR chyby byly opraveny.

## 11. Upravit a schválit
Správce může v čekajícím záznamu:
1. opravit OCR údaje,
2. přiřadit zaměstnance,
3. případně vytvořit Product Profile nebo zaměstnance,
4. uložit opravy,
5. schválit záznam.

## 12. Zamítnutí
Záznam lze zamítnout s možností uvést důvod, například:
- špatný screenshot,
- nespolehlivé OCR,
- nesprávný produkt,
- nesprávný zaměstnanec,
- duplicitní záznam.

## 13. Automatické zpracování bezpečných záznamů
Pokud systém bezpečně rozpozná a validuje datum, směnu, pracoviště, produkt, zaměstnance, potřebný Product Profile a výrobní data, není nutný ruční zásah.

Cíl: správce řeší pouze výjimky, nikoli desítky správných screenshotů.

## 14. Nová master data se nevytvářejí bez kontroly
Automatický import nesmí bez schválení vytvořit nový:
- zaměstnanec,
- Product Profile,
- případně jiný důležitý master-data záznam.

Automatizace může připravit návrh, ale vytvoření nového master záznamu musí projít kontrolou správce.

## 15. Auditní stopa
U problematického importu musí být možné zpětně zjistit:
- původní screenshot,
- kdy byl importován,
- co OCR rozpoznalo,
- OCR confidence,
- proč byl záznam zařazen ke schválení,
- co správce změnil,
- kdo záznam schválil nebo zamítl,
- kdy bylo rozhodnutí provedeno,
- jaká data byla nakonec uložena.

## 16. Kontrola duplicit
Systém musí kontrolovat opakovaný import stejného screenshotu nebo stejných výrobních dat a nesmí vytvářet duplicitní záznamy.

Při nalezení duplicity systém upozorní například: **Tento záznam již byl importován.**

## 17. Základní princip
**OCR → kontrola → oprava / přiřazení / vytvoření → Schválit**

Celkový tok:

**Screenshot → OCR → validace → bez problémů: automatické zpracování → problém: Ke schválení → kontrola screenshotu → oprava/přiřazení/vytvoření → Schválit → definitivní uložení dat**

## 18. Bezpečnostní zásada
Automatizovat vše, co lze bezpečně automatizovat, a člověku předložit pouze výjimky — vždy společně s původním screenshotem a možností opravit všechny OCR údaje.

---

**Verze konceptu:** 2.0 AUTO  
**Účel:** základní specifikace pro další implementaci a kontrolu odchylek během vývoje.
