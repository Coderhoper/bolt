# Deployment and first-time setup

## Supabase

1. Link the Supabase CLI to the project and apply the migrations in `supabase/migrations` in filename order. The hardware catalogue migration loads the supplied catalogue into the isolated `hardware_catalog` schema; it does not replace the operational tables in `public`.
2. Disable public sign-up in Supabase Authentication. Create the first trusted account in the Supabase dashboard, then promote its profile once using the SQL Editor:

   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE id = (SELECT id FROM auth.users WHERE email = 'your-admin@example.com');
   ```

3. Deploy the user administration function:

   ```sh
   supabase functions deploy admin-users
   ```

   The function uses Supabase's server-side service role environment variable. Never put a service-role key in the Vite app or Render environment.

## Render

The repository-root `render.yaml` defines a static site and now targets the connected Supabase project. Set `VITE_SUPABASE_ANON_KEY` in Render to the matching public anon key for that project, then deploy. The catalogue and all user administration operations run through Supabase.

The same build emits a separate owner console at `/owner.html`. Configure `VITE_OWNER_SUPABASE_URL` and `VITE_OWNER_SUPABASE_ANON_KEY` with a dedicated owner Supabase project before enabling that side. Follow [OWNER_CONTROL_PLANE.md](OWNER_CONTROL_PLANE.md) to apply its isolated migration and bootstrap owner staff. Never point owner variables at the tenant project or add service-role keys to the client.

## Product workflow

Products can only be added by selecting a SKU from the imported hardware catalogue. Cost and selling prices, suppliers, stock levels, and reorder levels are inventory-specific and are entered in the app. Product names, brands, units, and catalogue SKUs come from the catalogue and cannot be hand-created or changed in inventory.
