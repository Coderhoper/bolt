-- Older tenant databases may not have received the employee email column.
-- Keep worker creation compatible and refresh PostgREST's cached schema.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS email text;

NOTIFY pgrst, 'reload schema';
