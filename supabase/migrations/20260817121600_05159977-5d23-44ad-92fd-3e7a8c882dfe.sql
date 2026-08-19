CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text,
  active boolean NOT NULL DEFAULT true,
  first_seen_date date NOT NULL DEFAULT current_date,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_code_unique ON public.products (lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_authenticated_all ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.product_norms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  operation text NOT NULL,
  norm_per_hour numeric NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  source text NOT NULL DEFAULT 'manual',
  confirmed boolean NOT NULL DEFAULT false,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_norms TO authenticated;
GRANT ALL ON public.product_norms TO service_role;
ALTER TABLE public.product_norms ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_norms_authenticated_all ON public.product_norms FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER product_norms_updated_at BEFORE UPDATE ON public.product_norms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX product_norms_product_idx ON public.product_norms (product_id, operation, valid_from DESC);

ALTER TABLE public.daily_records
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN screenshot_path text,
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN performance numeric,
  ADD COLUMN available_time numeric;