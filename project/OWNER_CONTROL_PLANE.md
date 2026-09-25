# Owner control plane

The owner console is a second Vite entry point at `/owner.html`. It uses the same React, TypeScript, Tailwind, Supabase and Lucide stack and the same visual language as the tenant app. It has a separate Supabase URL, anonymous key, auth storage key, migration set, staff table and database. There is deliberately no fallback to the tenant Supabase project.

## Deploy the owner database

1. Create a dedicated Supabase project for platform operations. Do not reuse the business/tenant project.
2. Apply `supabase-owner/migrations/20260925000000_owner_control_plane.sql` to that project.
3. Disable public account registration. Invite the first owner staff account from Supabase Auth, enroll a verified TOTP MFA factor, then assign the platform role in the owner project's SQL editor:

   ```sql
   insert into public.owner_staff(user_id, role)
   select id, 'platform_admin'
   from auth.users
   where email = 'platform-admin@example.com';
   ```

4. Configure Supabase Auth to require MFA / assurance level `aal2` for owner staff. Database read and provisioning policies also require an `aal2` session. Do not provision shared accounts.
5. Set `VITE_OWNER_SUPABASE_URL` and `VITE_OWNER_SUPABASE_ANON_KEY` alongside the tenant app's existing variables in the static hosting environment. These are public client settings; never set a service-role key in Vite or a browser.
6. Build with `npm run build`. The tenant app is emitted as `dist/index.html`; the owner console is `dist/owner.html`.

The first owner role must be granted through the trusted Supabase dashboard/SQL editor. The browser cannot grant owner roles or edit audit records. Keep the owner project URL/key distinct from the tenant values in each deployment environment.

## Implemented owner workflow

- Tenant registration records UUID, slug, plan, region, primary business contact and environment isolation choice. The transaction queues an idempotent provisioning job and writes tenant creation to a tamper-evident audit chain. It does not enter tenant products, prices, staff or other business configuration.
- Separate screens are provided for the tenant registry, onboarding stages, aggregate telemetry, technical alerts, training progress, support tickets, billing records, platform operations and owner audit.
- Owner staff roles are `platform_admin`, `provisioner`, `support`, `analyst` and `auditor`. Only platform admins and provisioners can queue onboarding; no browser role can change its own role.
- Metrics store numeric, time-windowed aggregates. The owner project has no tenant product, sales, stock, employee or customer tables.
- Audit is append-only, uses a serialized SHA-256 hash chain and has a verification function. Export audit records off the database for independent retention.

## Integration seams still required

This repository does not contain the infrastructure credentials or services to provision separate customer databases. `provisioning_jobs` is a durable queue record only; a trusted server-side worker must claim jobs idempotently, create the tenant environment, apply tenant migrations, invite its first admin, register health checks and backups, then update status. Keep cloud/database credentials out of the Vite application.

Tenant telemetry must be aggregated at the tenant boundary and sent through an authenticated server-side ingestion endpoint. Send counts, latency percentiles, sync lag and technical health only; do not send business payloads, names, emails or user-level activity. Behavioral insights belong in each tenant's own app.

The support screen is not a break-glass grant mechanism. Before enabling tenant business-data access, deploy a restricted support proxy with an allow-list, tenant and table scope, mandatory incident reason and ticket, a second distinct approver, tenant notification, per-query audit and hard auto-expiry capped at 60 minutes. Block direct database connections from owner staff. Until that service exists, troubleshoot with operational metadata only.

Billing, feature flags, release orchestration, backups, retention/export, SIEM forwarding and tenant data deletion require explicit integrations and operational policies. Empty views mean there is no data source configured; the app does not synthesize example values.
