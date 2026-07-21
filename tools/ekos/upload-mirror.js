// upload-mirror.js — send out/ekos-mirror.sqlite to the STB App's private Blob
// store using the client-upload handshake: our app's /api/mirror-upload
// endpoint (which holds the store token) verifies this machine's Vercel OIDC
// identity and issues a scoped grant; the bytes then go directly to storage.
//
// Requires a logged-in Vercel CLI on this machine (for `vercel env pull`).
// Config (tools/ekos/.env, optional):
//   STB_APP_URL  — the app's production URL (default https://stb-exec-console.vercel.app)
//   STB_APP_DIR  — local path to the stb-exec-console repo (for vercel env pull)
// Usage: npm run upload   (or npm run sync:full for pull + upload)

require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DB_PATH = path.join(__dirname, 'out', 'ekos-mirror.sqlite');
// NOTE: stb-console.vercel.app is a DIFFERENT USER's site — never default to it.
// The scope-suffixed URL is guaranteed to be ours.
const APP_URL = (process.env.STB_APP_URL || 'https://spindletap-console.vercel.app').replace(/\/$/, '');
const APP_DIR = process.env.STB_APP_DIR || path.resolve(__dirname, '..', '..', '..', 'stb-exec-console');

function getOidcToken() {
  const tmp = '.env.oidc-tmp';
  execFileSync('npx', ['-y', 'vercel', 'env', 'pull', tmp, '--environment=production', '--yes'], {
    cwd: APP_DIR, stdio: ['ignore', 'ignore', 'inherit'], shell: true,
  });
  const file = path.join(APP_DIR, tmp);
  const text = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file);
  const m = text.match(/^VERCEL_OIDC_TOKEN="?([^"\r\n]+)"?$/m);
  if (!m) throw new Error('Could not obtain a Vercel OIDC token (is the Vercel CLI logged in?)');
  return m[1];
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No mirror at ' + DB_PATH + ' — run: npm run sync');
    process.exit(1);
  }
  const bytes = fs.readFileSync(DB_PATH);
  const mb = (bytes.length / 1024 / 1024).toFixed(1);
  console.log(`Uploading ${mb} MB via ${APP_URL} ...`);

  const token = getOidcToken();
  const { upload } = await import('@vercel/blob/client');
  const blob = await upload('ekos-mirror.sqlite', bytes, {
    access: 'private',
    handleUploadUrl: APP_URL + '/api/mirror-upload',
    contentType: 'application/octet-stream',
    headers: { authorization: 'Bearer ' + token },
    multipart: true,
  });
  console.log('Mirror uploaded:', blob.pathname, '->', blob.url);
  console.log('The app picks it up within ~15 minutes (or on next cold start).');
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
