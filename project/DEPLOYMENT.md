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

## Supplier receiving and automation

Apply all tenant migrations in filename order, including `20260929120000_supplier_receiving_workflow.sql` and `20260929150000_supplier_automation_platform.sql`. The workflow includes supplier approval/suspension, product/SKU mapping, PO and ASN transitions, private document storage, duplicate checks, extraction/review records, reconciliation, anomaly flags, scorecards, and an immutable stock-movement hash chain. Receipt posting requires a recorded human review and commits the purchase, stock movements, ASN/PO quantities, and supplier pricing in one database transaction. Credit notes and duplicate documents cannot post stock.

Deploy the edge functions after applying the migrations:

```sh
supabase functions deploy process-receiving-document
supabase functions deploy whatsapp-webhook
supabase functions deploy email-inbound-webhook
```

The document processor uses Azure Document Intelligence and can call OpenAI Responses for structured extraction. Set server-side function secrets; do not put these values in Vite or the browser:

| Secret | Required | Purpose |
| --- | --- | --- |
| `AZURE_DI_ENDPOINT` | Yes for Azure OCR | Azure Document Intelligence endpoint |
| `AZURE_DI_KEY` | Yes for Azure OCR | Azure Document Intelligence key |
| `OPENAI_API_KEY` | Optional | Structured extraction from redacted OCR text; requests set `store: false` |
| `OPENAI_MODEL` | Optional | Approved model name; defaults to `gpt-4o-mini` |
| `PADDLE_OCR_URL` | Optional | Self-hosted fallback adapter endpoint |
| `PADDLE_OCR_API_KEY` | Optional | Bearer token for the Paddle adapter |
| `META_APP_SECRET` | Yes for WhatsApp | Verifies `X-Hub-Signature-256` |
| `META_WEBHOOK_VERIFY_TOKEN` | Yes for WhatsApp | Meta webhook GET challenge |
| `WHATSAPP_ACCESS_TOKEN` | For media download/replies | WhatsApp Cloud API token |
| `WHATSAPP_GRAPH_VERSION` | For WhatsApp | Graph API version configured for the Meta app |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Yes for email | Shared secret checked from `X-Inbound-Email-Secret` |

Set secrets with `supabase secrets set NAME=value`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. The service role key is only used inside the two signed/secret-protected inbound handlers.

Configure **Automation & controls → Inbound document routing** with a Meta `phone_number_id` or receiving email address, plus each allowed sender. WhatsApp sender numbers are normalized to digits. To receive WhatsApp webhooks, subscribe the Meta app to the `messages` field and use `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook` as its callback. Incoming media must come from an allowlisted sender; `#help`, `#supplier CODE`, `#asn ASN-NUMBER`, and `#status ASN-NUMBER` are supported. The email function is a generic adapter: the mail provider must POST `to`, `from`, `subject`, `text`, and `attachments[]` entries containing `filename`, `content_type`, and `content_base64` to `/functions/v1/email-inbound-webhook`, with the configured secret header.

## Staff roles, audit, and live updates

Apply `20261002000000_staff_access_realtime_identity_documents.sql` and `20261002010000_employee_registration_sales_receipts.sql` to each existing tenant project. The migrations convert former read-only tenant memberships to the restricted `user` role, add the five-active-user limit, private employee ID uploads, PII-minimized audit snapshots, employee self-registration requests for admin approval, sales-only staff data access, secure server-priced sale recording, and saved receipt snapshots. Deploy the updated `admin-users` function and provisioning bundle after the migrations:

```sh
supabase db push --workdir supabase
supabase functions deploy admin-users --workdir supabase
supabase functions deploy owner-provisioning --workdir supabase-owner
```

Run the first two commands while linked to the existing tenant project, then deploy `owner-provisioning` while linked to the separate owner project so future tenant setups receive the updated migration bundle.

Future provisioned tenant projects receive this migration from the embedded migration bundle. Regenerate that bundle from `project/` whenever tenant migrations change:

```sh
npm run owner:embed-migrations
```

Tenant administrators keep full access. Employees can create an account from the tenant sign-in page, verify their email, and request access. An administrator approves the request; the account is always assigned the restricted `user` role, limited to the Sales page, recording sales, and viewing its own receipts. Each tenant can have at most five active staff users. Receipt details are snapshotted to the sales ledger and can be printed or saved as PDF. Employee email, phone, and national ID duplicates are rejected within a tenant; similar email addresses prompt a spelling review. ID images are private and administrator-only.

For an existing shared tenant project, a Supabase Owner or Administrator must enable email signups in **Authentication â†’ Sign-in / Providers**. Provisioning previously set `disable_signup=true`; future provisioned tenants receive the enabled setting after the updated `owner-provisioning` function is deployed. New accounts still have no tenant access until an administrator approves their request. Keep email verification enabled if you want Supabase to verify employee email addresses before they request access.

## Customer and supplier payments

Apply `20261002020000_payment_channels_daraja.sql` to each tenant database after the staff and receipt migrations. This adds a tenant-scoped payment ledger, configurable channels, encrypted Daraja credentials, M-Pesa STK callbacks, administrator M-Pesa supplier payouts and refunds, cash tender/change tracking, approved customer credit limits and FIFO credit receipts. Safaricom callbacks keep ambiguous requests in `PROCESSING` so an operator can check the ledger before attempting another charge.

Regenerate the provisioning bundle and deploy the payment function to the tenant project:

```powershell
npm.cmd --prefix project run owner:embed-migrations
npx.cmd supabase db push --workdir .\project\supabase --project-ref <tenant-project-ref>
npx.cmd supabase functions deploy payment-gateway --workdir .\project\supabase --project-ref <tenant-project-ref>
npx.cmd supabase functions deploy owner-provisioning --workdir .\project\supabase-owner --project-ref <owner-project-ref>
```

Run the first three Supabase commands against the tenant project. Deploy the last command against the separate owner project so future tenant projects receive the regenerated migration bundle. The `--prefix project` command runs the migration-bundle generator from the correct directory while keeping these commands runnable from the repository root. A Supabase project Owner or Administrator must run `db push`, function deployment, and secret configuration; a Developer role may not have access to these project endpoints.

Set the function's encryption key and the exact browser origin(s) used by the tenant app. Generate a separate key per tenant project and keep it backed up: the app cannot decrypt saved credentials after this key is lost.

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$PaymentKey = [Convert]::ToBase64String($bytes)
$rng.Dispose()
npx.cmd supabase secrets set "PAYMENT_CREDENTIALS_ENCRYPTION_KEY=$PaymentKey" "TENANT_APP_BASE_URL=https://your-live-domain.example" "TENANT_APP_ALLOWED_ORIGINS=https://your-live-domain.example" --workdir .\project\supabase --project-ref <tenant-project-ref>
```

In the tenant app, open **Settings → Payments** and enter that business's Daraja sandbox or production Consumer Key, Consumer Secret, shortcode, and Lipa na M-Pesa passkey. The server verifies the OAuth credentials and encrypts them before storage. To enable supplier payouts, also enter the B2C initiator name and Safaricom-generated security credential, then enable **M-Pesa supplier payout**. Production STK/B2C requires Safaricom to enable the corresponding product and shortcode. Do not paste API secrets into SQL, Vite variables, source files, chat, or a Git commit.

Employees can record a sale using channels enabled by their administrator. Cash change is calculated and saved; M-Pesa checkout requires a whole-KSh total and records Safaricom confirmation on the saved receipt; bank transfer and cheque remain pending for administrator confirmation. Credit is restricted to administrator-approved customers and available limits; manual receipts apply FIFO, and M-Pesa receipts settle the oldest invoice. Administrators can send a partial or full refund only for a confirmed M-Pesa sale, to the original payer phone, up to the amount received. Supplier payments can be sent from an outstanding purchase invoice to the supplier's saved phone; purchase balances change only after a successful B2C callback.

The Paddle fallback expects the self-hosted OCR adapter to accept the file bytes with their MIME type and return JSON shaped as `{ "text": "...", "lines": [{ "description": "...", "supplier_sku": null, "quantity": null, "unit": null, "unit_price": null, "confidence": 0.8, "source_page": 1, "source_bbox": null }], "structured": {} }`. Review and post every extracted receipt manually in the tenant app. Daily reconciliation is scheduled at 18:00 in each tenant's configured timezone when `pg_cron` is available; administrators can also run it from **Automation & controls**.

This repository's production stack is a Vite/Supabase shared database with tenant-scoped rows and RLS, so the workflow extends that architecture rather than introducing the separate per-tenant PostgreSQL clusters, NestJS/FastAPI service, Redis/BullMQ/NATS, Vault/KMS, Kubernetes, or OpenTelemetry stack listed in the aspirational specification. The web app supports mobile camera capture, but there is no separate Expo app or offline queue. Email/SMS/push delivery, supplier portal responses, and owner break-glass tooling still require service and owner-plane work outside these tenant workflows. The email webhook is an adapter contract, not a provider-specific mailbox integration.
