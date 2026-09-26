# Owner control plane

The owner console is a second Vite entry point at `/owner.html`. It uses the same React, TypeScript, Tailwind, Supabase and Lucide stack and the same visual language as the tenant app. It has a separate Supabase URL, anonymous key, auth storage key, migration set, staff table and database. There is deliberately no fallback to the tenant Supabase project.

## Deploy the owner database

1. Create a dedicated Supabase project for platform operations. Do not reuse the business/tenant project.
2. From the repository root, run `supabase db push --workdir project/supabase-owner --linked` to apply that project's isolated migration.
3. Disable public account registration. Create the first owner staff account through Supabase Auth. The owner sign-in screen enrolls a verified TOTP factor on first sign-in, then requires a code on each new session.

   ```sql
   insert into public.owner_staff(user_id, role)
   select id, 'platform_admin'
   from auth.users
   where email = 'platform-admin@example.com';
   ```

4. Configure Supabase Auth to require MFA / assurance level `aal2` for owner staff. Database read and provisioning policies also require an `aal2` session. Do not provision shared accounts.
5. Owner-side Supabase organization connectivity is checked by the authenticated `owner-provisioning` Edge Function. Set the Management API token as the owner project secret `lapdav` and the target organization slug as `org_slug`. Use a scoped PAT with `Organization Projects: Read-write` for that organization; do not grant access to every organization or project. Deploy the function with `supabase functions deploy owner-provisioning --workdir project/supabase-owner --project-ref <owner-project-ref>`. In the owner console, open **Platform → Check connection**. This check makes a read-only organization-projects request; it does not create a project. Project creation, tenant migration, and admin invitation remain disabled until separately implemented and explicitly enabled.
6. The owner message console uses Postmark for email, Twilio for SMS, and Meta WhatsApp Cloud for direct messages. Deploy `owner-communications` from `project/supabase-owner/supabase/functions`, then set provider tokens with `supabase secrets set --workdir project/supabase-owner KEY=value`. Required names are listed in the Communications screen. Provider secrets stay in the Edge Function environment; the browser stores only sender metadata. Configure provider domains, verified senders, webhook signatures and message templates before enabling production sends.
7. Set `VITE_OWNER_SUPABASE_URL` and `VITE_OWNER_SUPABASE_ANON_KEY` alongside the tenant app's existing variables in the static hosting environment. These are public client settings; never set a service-role key in Vite or a browser.
8. Build with `npm run build`. The tenant app is emitted as `dist/index.html`; the owner console is `dist/owner.html`.

The first owner role must be granted through the trusted Supabase dashboard/SQL editor. The browser cannot grant owner roles or edit audit records. Keep the owner project URL/key distinct from the tenant values in each deployment environment.

## Implemented owner workflow

- Tenant registration records UUID, slug, plan, region, primary business contact and environment isolation choice. The transaction queues an idempotent provisioning job and writes tenant creation to a tamper-evident audit chain. It does not enter tenant products, prices, staff or other business configuration.
- Separate screens are provided for the tenant registry, onboarding stages, aggregate telemetry, technical alerts, training progress, support tickets, billing records, platform operations and owner audit.
- Owner staff roles are `platform_admin`, `provisioner`, `support`, `analyst` and `auditor`. Only platform admins and provisioners can queue onboarding; no browser role can change its own role.
- Metrics store numeric, time-windowed aggregates. The owner project has no tenant product, sales, stock, employee or customer tables.
- Audit is append-only, uses a serialized SHA-256 hash chain and has a verification function. Export audit records off the database for independent retention.
- Owner communications can send one-recipient email, SMS, and WhatsApp notifications through a centralized Edge Function. Delivery logs retain channel, provider, status, error code and a recipient hash only; they do not store message content or recipient addresses. Provider delivery webhooks, retries, fallback providers and durable worker processing remain deployment work before high-volume use.

## Integration seams still required

`provisioning_jobs` is a durable queue record only. The current `owner-provisioning` function verifies Management API connectivity and intentionally performs no mutations. A trusted server-side worker must still claim jobs idempotently, create the tenant environment, apply tenant migrations, invite its first admin, register health checks and backups, then update status. Keep cloud/database credentials out of the Vite application.

Tenant telemetry must be aggregated at the tenant boundary and sent through an authenticated server-side ingestion endpoint. Send counts, latency percentiles, sync lag and technical health only; do not send business payloads, names, emails or user-level activity. Behavioral insights belong in each tenant's own app.

The support screen is not a break-glass grant mechanism. Before enabling tenant business-data access, deploy a restricted support proxy with an allow-list, tenant and table scope, mandatory incident reason and ticket, a second distinct approver, tenant notification, per-query audit and hard auto-expiry capped at 60 minutes. Block direct database connections from owner staff. Until that service exists, troubleshoot with operational metadata only.

Billing, feature flags, release orchestration, backups, retention/export, SIEM forwarding and tenant data deletion require explicit integrations and operational policies. Empty views mean there is no data source configured; the app does not synthesize example values.
