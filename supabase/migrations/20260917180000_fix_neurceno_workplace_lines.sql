-- pracoviste.tsx's parseImportedLine() required the line token (e.g.
-- "L3/1") to be the very last thing in the source string. Real workplace
-- names like "HandAssy L3/1 el.WI" or "HandAssy L1/1_1 - OPF" have extra
-- descriptive text after the token, so the regex never matched at all and
-- these 4 already-persisted rows got stuck with line_name "Neurčeno" and
-- the whole raw string dumped into workplace_name. Fixed in the frontend
-- parser (relaxed to find the token anywhere, keeping text on both sides
-- as part of the workplace name); these 4 rows were already inserted
-- before that fix existed, so they need a one-time correction to match
-- what the fixed parser now produces for the same source_line values.
-- Also gives these workplaces a real line_name instead of "Neurčeno",
-- which find_ha_tup_link() explicitly treats as "no evidence of pairing" -
-- so this also makes correct HA->TUP linkage possible for these lines.
update public.workplaces set line_name = 'L1/1_1', workplace_name = 'HandAssy OPF' where id = '4e01f230-b0a7-42cc-be5f-eaa64ce622d6' and source_line = '041.02 - HandAssy L1/1_1 - OPF';
update public.workplaces set line_name = 'L3/1', workplace_name = 'HandAssy el.WI' where id = '06b172c4-61c2-41af-84be-ee2645902880' and source_line = '041.06 - HandAssy L3/1 el.WI';
update public.workplaces set line_name = 'L3/2', workplace_name = 'HandAssy el.WI' where id = '8ef44d07-720b-4279-8535-039b31a5af54' and source_line = '041.07 - HandAssy L3/2 el.WI';
update public.workplaces set line_name = 'L3/4', workplace_name = 'HandAssy el.WI' where id = 'f4c935b9-3949-472d-bf24-fbdfa6f6ad86' and source_line = '041.09 - HandAssy L3/4 el.WI';
