// upload-mirror.js — push out/ekos-mirror.sqlite to Vercel Blob so the deployed
// STB App (Production chatbot) can read it. Stable pathname, overwritten in
// place, so MIRROR_URL is set once in the app's Vercel env and never changes.
//
// Needs BLOB_READ_WRITE_TOKEN in tools/ekos/.env (from the stb-exec-console
// Vercel project: Storage -> Blob -> create store -> token).
// Usage: npm run upload   (or npm run sync:full for pull + upload)

require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'out', 'ekos-mirror.sqlite');

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN not set (tools/ekos/.env) — skipping upload.');
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error('No mirror at ' + DB_PATH + ' — run: npm run sync');
    process.exit(1);
  }
  const { put } = require('@vercel/blob');
  const result = await put('ekos-mirror.sqlite', fs.readFileSync(DB_PATH), {
    access: 'public', // URL is unguessable (random store host); the app itself is auth-gated
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/octet-stream',
  });
  const mb = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Uploaded ${mb} MB -> ${result.url}`);
  console.log('Set MIRROR_URL to this URL in the stb-exec-console Vercel env (first time only).');
}

main().catch((err) => { console.error(err); process.exit(1); });
