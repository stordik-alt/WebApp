-- Number of operators the product is designed for.
-- The value belongs to the product because the hourly norm is defined for that crew size.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS employees_per_product integer NOT NULL DEFAULT 1;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_employees_per_product_positive;

ALTER TABLE public.products
  ADD CONSTRAINT products_employees_per_product_positive
  CHECK (employees_per_product >= 1);

-- Existing products remain valid with the historical/default crew size of one operator.
NOTIFY pgrst, 'reload schema';
