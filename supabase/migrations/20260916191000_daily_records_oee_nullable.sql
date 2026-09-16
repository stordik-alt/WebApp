-- The manual daily-record form (denni-data.tsx) labels OEE "nepovinné" (optional) and the
-- app-level DailyRecord type already treats oee as number | null everywhere, but the column
-- was still NOT NULL with no default. Submitting the form with OEE left blank sent oee: null
-- and failed with a not-null violation. Align the column with the app's actual contract.
alter table public.daily_records alter column oee drop not null;
