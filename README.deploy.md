# Danielwebsite

## Deploy to GoDaddy from GitHub (automatic)

This repo includes a GitHub Actions workflow that deploys to GoDaddy **on every push to `main`** using **FTP/FTPS**.

### 1) Create GitHub Secrets

In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

- **`GODADDY_FTP_SERVER`**: Your GoDaddy FTP host (example: `ftp.yourdomain.com`)
- **`GODADDY_FTP_USERNAME`**: FTP username
- **`GODADDY_FTP_PASSWORD`**: FTP password
- **`GODADDY_FTP_REMOTE_DIR`**: Remote path to your web root (often `/public_html/`)
- **`GODADDY_FTP_PROTOCOL`**: `ftp` or `ftps` (recommended when available)
- **`GODADDY_FTP_PORT`**: `21` for FTP/FTPS (or your GoDaddy-provided port)

### 2) Ensure GoDaddy points at the right directory

Your hosting should serve `index.html` from the directory you set in `GODADDY_FTP_REMOTE_DIR` (commonly `/public_html/`).

### 3) Push to deploy

Any push to `main` triggers the workflow in `.github/workflows/godaddy-deploy.yml`.

## Notes (important)

- If your GoDaddy plan is **shared hosting without Node.js**, it will only serve the **static site** (HTML/CSS/JS). The Express API in `server.js` will not run there.
- If your plan includes **cPanel “Setup Node.js App”**, you can run `server.js`, but it requires GoDaddy-side setup (app root, startup file, environment variables, and a restart after deploy).

