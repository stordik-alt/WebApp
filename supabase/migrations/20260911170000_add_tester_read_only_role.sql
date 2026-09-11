-- Add the Tester role first. PostgreSQL makes a newly added enum value
-- visible to subsequent statements only after the transaction commits.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tester';
