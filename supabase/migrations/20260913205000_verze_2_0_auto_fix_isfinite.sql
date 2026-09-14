-- Verze 2.0 AUTO
-- Oprava PostgreSQL: isfinite(double precision) neexistuje.
-- Starší AUTO RPC používá isfinite(...::double precision). V PostgreSQL
-- je proto nutné dodat explicitní helper pro konečná čísla.
-- NaN ani +/-Infinity nejsou považovány za platnou KPI hodnotu.

create or replace function public.isfinite(p_value double precision)
returns boolean
language sql
immutable
strict
as $$
  select p_value <> 'NaN'::double precision
     and p_value <> 'Infinity'::double precision
     and p_value <> '-Infinity'::double precision;
$$;

revoke all on function public.isfinite(double precision) from public;
grant execute on function public.isfinite(double precision) to authenticated;

comment on function public.isfinite(double precision) is
  '2.0 AUTO helper: validace konečného double precision; nahrazuje neexistující PostgreSQL isfinite(double precision).';
