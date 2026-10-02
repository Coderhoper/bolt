# Owner control plane

The owner console is a second Vite entry point at `/owner.html`. It uses the same React, TypeScript, Tailwind, Supabase and Lucide stack as the tenant app, with a separate Supabase project, database, auth storage key, staff table and migrations. It has no fallback to the tenant database.

## Deploy the owner database and provisioning worker

Run these commands from the repository root, replacing `<owner-project-ref>` with the Owner Supabase project reference:

```powershell
npx supabase link --project-ref <owner-project-ref> --workdir project/supabase-owner
npx supabase db push --dry-run --workdir project/supabase-owner
npx supabase db push --workdir project/supabase-owner
```

The dry run should list the shared-database onboarding migration followed by the Owner operations and bridge migrations (`20260926030000` and `20260926040000`). Review the list, then run the final command to apply them. The operations migration creates business-size packages, subscriptions, invoice records, training courses, meetings and outcome records, the tenant admin inbox, support threads and aggregate telemetry. The final migration seeds monthly package prices and creates the service-only customer bridge RPCs. Create the first owner staff account through Supabase Auth and grant its role from the trusted SQL editor:

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
npx supabase functions deploy tenant-bridge --workdir supabase-owner --project-ref <owner-project-ref> --use-api
```

`tenant-bridge` has JWT gateway verification disabled because tenant users have tokens from the shared tenant project. The function verifies each token with that project, confirms the selected tenant membership there, and then applies Owner-side operations through its server key. Do not expose the Owner service key in the tenant application.

The bridge allows the production app origin above and localhost by default. If the app uses a custom domain or another Vercel production origin, allow its exact origin in the Owner project's Edge Function secrets (comma-separated for multiple origins), then redeploy the tenant app if its public Owner URL/key changed:

```powershell
npx supabase secrets set TENANT_APP_ALLOWED_ORIGINS=https://app.example.com --workdir supabase-owner --project-ref <owner-project-ref>
```

The browser will show an actionable error if it cannot reach the bridge, which usually means the function has not been deployed to the Owner project or the current app origin is not allowed.

Set these secrets on the Owner Supabase project using values from your own Supabase organization; never put them in Vite or commit them:

- `lapdav`: a scoped Supabase Management API personal access token. It needs permission to list organization projects, manage API keys for the shared tenant project, apply database migrations (or run database write queries if the migrations API is unavailable), and update its Auth configuration.
- `org_slug`: the Supabase organization slug, not a project reference.
- `tenant_shared_project_ref`: the 20-character reference of the separate shared tenant project you create in that organization. It is not the Owner project or the current general-management project.
- `TENANT_APP_BASE_URL`: `https://bolt-six-mauve.vercel.app` for the current tenant deployment. This can be omitted while that remains the correct URL.

Set the values in the Owner project's Edge Function secrets in the Supabase Dashboard, or use a protected local environment file with the Supabase CLI. Do not put the token in source code, chat, shell history, or a Vite `VITE_*` variable. The **Platform → Check connection** button only verifies organization read access; it does not create or change projects.

## Deploy the web app

Configure the Vercel project to use `project` as its Root Directory, `npm run build` as its Build Command, and `dist` as its Output Directory. Add the Owner project's URL and publishable key as `VITE_OWNER_SUPABASE_URL` and `VITE_OWNER_SUPABASE_ANON_KEY`. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` pointed at the current general-management project for the root app. Tenant routes `/t/<slug>` resolve to the separate shared tenant project at runtime. These browser values are public keys; never put a Supabase secret or service-role key into Vercel's client-side variables.

The build emits `dist/owner.html` for the owner console and `dist/index.html` for the tenant app. The Vercel rewrite routes `/t/<slug>` to the tenant app. The tenant app resolves the active tenant's ID, shared database URL and publishable key from the Owner database before creating a tenant-scoped Supabase client.

## Owner workflows

- **Meetings:** Owner staff schedule onboarding, training, support and review meetings, store an external provider and HTTPS join URL, and record attendance/outcome and follow-up. Tenant administrators see their schedule and meeting link on the tenant dashboard. Meeting video is opened through the provider's link; a video provider/API has not been selected.
- **Business packages:** Small businesses are seeded at KES 20,000/month, medium at KES 35,000/month, and large at KES 40,000/month. This maps the supplied prices in ascending order by business size; package pricing, size criteria and features can be edited by a platform administrator.
- **Billing:** Subscription and invoice records are available in manual mode. Payment collection is disabled until a gateway is selected and configured. Mark an invoice paid only after confirming payment separately.
- **Tenant inbox and support:** Owner notices appear on the tenant dashboard for active tenant administrators only. Tenant administrators can open support tickets, reply to support threads and report a fixed-category technical alert. The bridge verifies the tenant project's Auth token and tenant membership before each operation.
- **Usage analytics:** Authenticated tenant app page visits report one of a fixed set of page buckets. The Owner database stores hourly numeric counts only, without sales, employee, product or customer records.

## Tenant onboarding flow

1. Create one separate Supabase project in the configured organization for all tenant businesses. Do not use the Owner project or current general-management project. This shared project must exist before tenant onboarding. Leave its business tables empty and do not create tenant Auth users before onboarding runs.
2. Set `tenant_shared_project_ref` to that project's reference in the Owner project's Edge Function secrets. Confirm `org_slug` points to the organization containing the new project.
3. From `project`, deploy the tenant user-management function once to the shared project:

```powershell
npx supabase functions deploy admin-users --project-ref <tenant-shared-project-ref> --use-api
```

Configure SMTP for the shared project's Auth service so administrator and staff invitations can be delivered. Set `TENANT_APP_BASE_URL` as a secret on the shared project's Edge Functions if the production URL differs from `https://bolt-six-mauve.vercel.app`.
4. In the Owner console, register the tenant with a unique slug, plan, and the first administrator's email.
5. Choose **Provision**. The worker reuses the configured project, applies the schema and hardware catalogue migrations once, creates the tenant workspace and administrator membership, configures Auth redirects for `/t/<slug>`, sends the invite, and only then marks the tenant active.
6. Give the administrator the `/t/<slug>` link. Tenant requests include the resolved tenant ID, while database row policies and tenant-aware foreign keys keep business records separated. Tenant user management checks and changes memberships for the current business only; users shared between businesses keep independent roles and status per membership.

Jobs record each step and can be resumed after a failed step. New tenants use `shared_database`; onboarding does not create Supabase projects. The shared tenant migration removes only the untouched `My Business` settings placeholder and stops if it finds other unassigned business rows. The one shared project still counts against the Supabase organization's project limits and plan.

## Security and implemented scope

- Owner roles are `platform_admin`, `provisioner`, `support`, `analyst` and `auditor`. Only admins and provisioners can queue or run onboarding.
- The browser cannot create owner roles, modify audit records, or access the Management API token. The worker verifies the user's Owner session, `aal2`, and staff role before provisioning.
- The Owner database stores tenant routing metadata and a browser-safe publishable key. It never stores tenant database passwords or secret API keys.
- The shared tenant database stores one workspace and membership set per Owner tenant ID. Row-level policies, write guards and composite foreign keys enforce tenant boundaries; the master hardware catalogue is global read-only data. Existing dedicated-project tenants keep their legacy profile authorization and do not receive a shared tenant header.
- The Owner project receives aggregate telemetry, technical alerts, training progress, support tickets, and billing metadata. It does not hold tenant product, sales, stock, employee or customer rows.
- The communications console supports provider integration for email, SMS and WhatsApp. Provider secrets stay in Edge Function settings. Configure verified senders, templates and webhooks before enabling live sends.

Payment collection, meeting-provider calendar/video APIs, feature flags, release orchestration, backup/restore automation, retention/export, SIEM forwarding and deletion workflows still need their respective integrations and operating policies. The support screen does not grant direct tenant database access; any break-glass service needs scoped access, two-person approval, notification, audit and automatic expiry.
