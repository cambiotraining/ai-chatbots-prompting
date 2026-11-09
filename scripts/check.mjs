import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.wrangler', 'work'].includes(entry.name)) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(mjs|js)$/.test(path)) { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); count++; }
  }
}
await walk(root);
const html = await readFile(resolve(root, 'public/index.html'), 'utf8');
for (const asset of ['./style.css', './config.js', './app.mjs']) if (!html.includes(asset)) throw new Error(`Missing asset ${asset}`);
const wrangler = await readFile(resolve(root, 'wrangler.toml'), 'utf8');
const publicSecret = wrangler.match(/^[ \t]*["']?(OPENAI_API_KEY|WORKSHOP_CODE|ADMIN_TOKEN|SESSION_SECRET|WORKSHOP_ID)["']?[ \t]*=/m);
if (publicSecret) throw new Error(`Store ${publicSecret[1]} as a Cloudflare Worker secret instead of assigning it in wrangler.toml.`);
for (const entry of await readdir(resolve(root, 'public'))) {
  if (entry.startsWith('.env') || entry.includes('vars')) throw new Error('Secret configuration must not be published.');
  const content = await readFile(resolve(root, 'public', entry), 'utf8');
  if (/sk-(?:proj-)?[A-Za-z0-9_-]{24,}/.test(content)) throw new Error(`Possible API key in public/${entry}`);
}
console.log(`Checked syntax of ${count} JavaScript files, frontend asset links, and public configuration for accidental credentials.`);
