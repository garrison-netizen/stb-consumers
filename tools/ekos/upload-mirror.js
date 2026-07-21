// upload-mirror.js — send out/ekos-mirror.sqlite to the STB App's private Blob
// store through the app's /api/mirror-upload relay endpoint.
//
// Why a relay: the Blob store is Private, its token is sealed inside Vercel
// deployments, and Vercel rejects local-machine OIDC blob writes. So we
// authenticate to OUR OWN app with a fresh Vercel OIDC JWT (via `vercel env
// pull`, requires a logged-in Vercel CLI on this machine) and the app writes
// the store with the token it holds.
//
// Config (tools/ekos/.env, optional):
//   STB_APP_URL  — the app's production URL (default https://stb-exec-console.vercel.app)
//   STB_APP_DIR  — local path to the stb-exec-console repo (for vercel env pull)
// Usage: npm run upload   (or npm run sync:full for pull + upload)

require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DB_PATH = path.join(__dirname, 'out', 'ekos-mirror.sqlite');
const APP_URL = (process.env.STB_APP_URL || 'https://stb-exec-console.vercel.app').replace(/\/$/, '');
const APP_DIR = process.env.STB_APP_DIR || path.resolve(__dirname, '..', '..', '..', 'stb-exec-console');
const CHUNK = 3 * 1024 * 1024; // 3MB raw -> ~4MB base64, under the 4.5MB body cap

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

async function call(token, body) {
  const resp = await fetch(APP_URL + '/api/mirror-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    throw new Error(`mirror-upload ${body.action} failed (${resp.status}): ${data.error || 'unknown'}`);
  }
  return data;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No mirror at ' + DB_PATH + ' — run: npm run sync');
    process.exit(1);
  }
  const bytes = fs.readFileSync(DB_PATH);
  const mb = (bytes.length / 1024 / 1024).toFixed(1);
  console.log(`Uploading ${mb} MB to ${APP_URL} ...`);

  const token = getOidcToken();
  const { uploadId, key } = await call(token, { action: 'create' });

  const parts = [];
  const totalParts = Math.ceil(bytes.length / CHUNK);
  for (let i = 0; i < totalParts; i++) {
    const slice = bytes.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.length));
    const { part } = await call(token, {
      action: 'part', uploadId, key,
      partNumber: i + 1,
      dataBase64: Buffer.from(slice).toString('base64'),
    });
    parts.push(part);
    process.stdout.write(`  part ${i + 1}/${totalParts} ok\r\n`);
  }

  const { url } = await call(token, { action: 'complete', uploadId, key, parts });
  console.log('Mirror uploaded. The app will pick it up within ~15 minutes (or on next cold start).');
  if (url) console.log('Blob: ' + url);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
