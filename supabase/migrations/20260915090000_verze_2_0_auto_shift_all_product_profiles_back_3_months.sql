-- Version 2.0 AUTO
-- Product Profiles were created while the source screenshots were being
-- collected. Their validity dates represent the import/catalog timeline and
-- must be aligned three months earlier with that collection period.
-- Shift both bounds together so profile validity durations remain unchanged.

begin;

update public.product_profiles
set
  valid_from = (valid_from - interval '3 months')::date,
  valid_to = case
    when valid_to is null then null
    else (valid_to - interval '3 months')::date
  end;

commit;
