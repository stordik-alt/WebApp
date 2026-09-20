-- Verze 2.02 "Interaktivní prostředí" — oprava skupin dle skutečné haly.
-- Best-effort rekonstrukce z Fáze A měla Delta/Ersa prohozené a Olovo bez
-- druhého názvu; TL potvrdil skutečnost: L1 = Ersa, L3 = Delta, Olovo = Vectra.
-- Neměnný audit trail - opravuje se novou migrací, ne úpravou té původní.

begin;

update public.iw_workstations set group_name = 'L1 (Ersa)' where group_name = 'L1 (Delta)';
update public.iw_workstations set group_name = 'L3 (Delta)' where group_name = 'L3 (Ersa)';
update public.iw_workstations set group_name = 'Olovo (Vectra)' where group_name = 'Olovo';

commit;
