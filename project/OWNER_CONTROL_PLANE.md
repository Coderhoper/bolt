# Owner control plane

The owner console is a second Vite entry point at `/owner.html`. It uses the same React, TypeScript, Tailwind, Supabase and Lucide stack as the tenant app, with a separate Supabase project, database, auth storage key, staff table and migrations. It has no fallback to the tenant database.

## Deploy the owner database and provisioning worker

Run these commands from the repository root, replacing `<owner-project-ref>` with the Owner Supabase project reference:

```powershell
npx supabase link --project-ref <owner-project-ref> --workdir project/supabase-owner
npx supabase db push --dry-run --workdir project/supabase-owner
npx supabase db push --workdir project/supabase-owner
```

The dry run should list the new tenant-provisioning migration before applying it. Review that list, then run the final command to apply it. Create the first owner staff account through Supabase Auth and grant its role from the trusted SQL editor:

```sql
insert into public.owner_staff(user_id, role)
select id, 'platform_admin'
from auth.users
where email = 'platform-admin@example.com';
```

Disable public account registration and require verified TOTP / assurance level `aal2` for owner staff. Do not share owner accounts.

Embed the checked-in tenant migrations into the trusted provisioning function and deploy it:

```powershell
cd project
npm run owner:embed-migrations
npx supabase functions deploy owner-provisioning --workdir supabase-owner --project-ref <owner-project-ref> --use-api
```

Set these secrets on the Owner Supabase project using values from your own Supabase organization; never put them in Vite or commit them:

- `lapdav`: a scoped Supabase Management API personal access token. It needs permission to create organization projects, manage project API keys, apply database migrations (or run database write queries if the migrations API is unavailable), and update tenant Auth configuration.
- `org_slug`: the Supabase organization slug, not a project reference.
- `TENANT_APP_BASE_URL`: `https://bolt-six-mauve.vercel.app` for the current tenant deployment. This can be omitted while that remains the correct URL.

Set the values in the Owner project's Edge Function secrets in the Supabase Dashboard, or use a protected local environment file with the Supabase CLI. Do not put the token in source code, chat, shell history, or a Vite `VITE_*` variable. The **Platform → Check connection** button only verifies organization read access; it does not create or change projects.

## Deploy the web app

Configure the Vercel project to use `project` as its Root Directory, `npm run build` as its Build Command, and `dist` as its Output Directory. Add the Owner project's URL and publishable key as `VITE_OWNER_SUPABASE_URL` and `VITE_OWNER_SUPABASE_ANON_KEY`. Keep the tenant app's existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` settings. These browser values are public keys; never put a Supabase secret or service-role key into Vercel's client-side variables.

The build emits `dist/owner.html` for the owner console and `dist/index.html` for the tenant app. The Vercel rewrite routes `/t/<slug>` to the tenant app. The tenant app resolves the active tenant's URL and publishable key from the Owner database before creating its tenant Supabase client.

## Tenant onboarding flow

1. In the Owner console, register the tenant with a unique slug, region, plan, and the first administrator's email.
2. Choose **Provision**. The worker creates a dedicated Supabase project, waits for the database and Auth services, applies every checked-in tenant migration (including the hardware catalogue), configures Auth redirects for `/t/<slug>`, invites the administrator, and only then marks the tenant active.
3. Give the administrator the `/t/<slug>` link. The invite link returns them to this tenant route, and the app connects to that tenant's isolated database.

Jobs record each step and can be resumed after a failed step. Only `database_per_tenant` is supported. Supabase currently has no project region in Africa, so `africa-east` maps to Mumbai and `africa-south` to Ireland; this is nearest-region placement, not a data-residency guarantee. New projects count against the Supabase organization's project limits and may incur billing. Check the organization's capacity and plan before provisioning a real customer.

## Security and implemented scope

- Owner roles are `platform_admin`, `provisioner`, `support`, `analyst` and `auditor`. Only admins and provisioners can queue or run onboarding.
- The browser cannot create owner roles, modify audit records, or access the Management API token. The worker verifies the user's Owner session, `aal2`, and staff role before provisioning.
- The Owner database stores only tenant routing metadata and a browser-safe publishable key. It never stores tenant database passwords or secret API keys.
- The Owner project receives aggregate telemetry, technical alerts, training progress, support tickets, and billing metadata. It does not hold tenant product, sales, stock, employee or customer rows.
- The communications console supports provider integration for email, SMS and WhatsApp. Provider secrets stay in Edge Function settings. Configure verified senders, templates and webhooks before enabling live sends.

Tenant telemetry ingestion, customer-to-owner alerts, tenant-admin-only inbox delivery, provider webhooks/retries, billing, feature flags, release orchestration, backups, retention/export, SIEM forwarding and data deletion still need their respective integrations and operating policies. Empty owner views indicate that no source is connected. The support screen does not grant direct tenant database access; any break-glass service needs scoped access, two-person approval, notification, audit and automatic expiry.
