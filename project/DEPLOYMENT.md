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

## Vercel

Import the Git repository into Vercel and set the project Root Directory to `project`. `vercel.json` configures Vite to run `npm ci` and `npm run build`, publishing `dist/` with both the tenant app (`/`) and owner console (`/owner.html`).

Set these variables for the Production environment in Vercel before deploying:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Tenant Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Tenant project's public anon/publishable key |
| `VITE_OWNER_SUPABASE_URL` | `https://hiabtvocfdqguapithdd.supabase.co` |
| `VITE_OWNER_SUPABASE_ANON_KEY` | Owner project's public anon/publishable key |

These Vite variables are included in browser code and must contain public keys only. Never add a service-role key, `lapdav`, or any Management API token to Vercel. Those credentials remain in the owner Supabase Edge Function secrets. Redeploy after changing Vite variables because they are read at build time.

After the first Vercel deployment, open both `/` and `/owner.html`, complete owner MFA, and use **Platform → Check connection**. Add the Vercel production URL to the Site URL / redirect URL settings of the tenant and owner Supabase Auth projects if email links or OAuth callbacks are used.

The existing Render service configuration is retained temporarily for rollback until the Vercel deployment and custom domain are verified. Disable Render auto-deploy after the cutover is complete.

Follow [OWNER_CONTROL_PLANE.md](OWNER_CONTROL_PLANE.md) to apply the owner's isolated migration and bootstrap owner staff. Never point owner variables at the tenant project or add service-role keys to the client.

## Product workflow

Products can only be added by selecting a SKU from the imported hardware catalogue. Cost and selling prices, suppliers, stock levels, and reorder levels are inventory-specific and are entered in the app. Product names, brands, units, and catalogue SKUs come from the catalogue and cannot be hand-created or changed in inventory.
