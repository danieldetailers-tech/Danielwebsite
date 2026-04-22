## Cloudflare Pages setup (this repo)

This project is a static website (`index.html`, `styles.css`, `app.js`, `assets/`) with API routes implemented via **Cloudflare Pages Functions** backed by **Cloudflare D1**.

### Pages settings

- **Framework preset**: None
- **Build command**: (leave empty)
- **Build output directory**: `.`

### Create the D1 database + run migrations

In Cloudflare Dashboard:

1. **Workers & Pages → D1 → Create database**
2. Name it: `daniels_detailers`

Then bind it to your Pages project:

- **Pages → your project → Settings → Functions → D1 database bindings**
- Add binding:
  - **Variable name**: `DB`
  - **D1 database**: `daniels_detailers`

Apply the schema by running the migration in the Cloudflare dashboard (D1 → Console) or via Wrangler locally.

Migration file: `migrations/0001_init.sql`

