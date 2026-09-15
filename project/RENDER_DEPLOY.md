# Deploying Bolt frontend to Render

This file explains the minimal steps to deploy the `project` frontend to Render using the `render.yaml` manifest included in the repo.

1) Connect repository
- In Render, create a new Static Site and connect the GitHub repository `Coderhoper/bolt` (branch `main`).
- Render will detect the `render.yaml` manifest and use its settings.

2) Build & Publish
- Build command (from manifest): `cd project && npm ci && npm run build`
- Publish directory: `project/dist`

3) Environment variables (set in Render → Environment)
- `VITE_SUPABASE_URL` = https://<your-project>.supabase.co
- `VITE_SUPABASE_ANON_KEY` = <anon-public-key>

Optional (server-only secret)
- `SUPABASE_SERVICE_ROLE` = <service_role_key> (mark as secret; do not expose to browser)

4) Trigger deploy
- After setting environment variables, click Deploy. Render will run the manifest build and publish `project/dist`.

Local build/test
- To build locally and verify output:
```bash
cd project
npm ci
npm run build
npx serve dist  # optional - install serve or use any static server to preview
```

Notes
- Keep service role keys secret; only set them in Render's dashboard as protected environment variables.
- If you need server-side background jobs that call Supabase with the service role, configure them as a separate Render Service (not a static site) and reference the same repository/branch.
