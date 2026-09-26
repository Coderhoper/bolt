# Hardware Business Manager

React, TypeScript, and Supabase app for hardware inventory, sales, purchasing, staff, and reporting.

## Development

```sh
cd project
npm ci
npm run dev
```

## Setup and deployment

See [project/DEPLOYMENT.md](project/DEPLOYMENT.md) for Supabase migrations, first administrator setup, catalogue loading, Edge Function deployment, and Vercel deployment.

The platform owner console is a separate application entry at `/owner.html`, backed by its own Supabase project and staff identity boundary. See [project/OWNER_CONTROL_PLANE.md](project/OWNER_CONTROL_PLANE.md) for setup, onboarding scope, audit controls, and integrations still required.
