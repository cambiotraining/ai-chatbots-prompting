import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import worker, { Workshop } from '../worker/index.mjs';
import { secretConfigurationIssues } from '../worker/security.mjs';
import { LocalStorage } from './storage.mjs';
import { loadEnv } from './env.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const secrets = await loadEnv();
const env = {
  ...secrets,
  WORKSHOP_CODE: secrets.WORKSHOP_CODE || 'local-workshop',
  ADMIN_TOKEN: secrets.ADMIN_TOKEN || 'local-facilitator',
  SESSION_SECRET: secrets.SESSION_SECRET || randomBytes(32).toString('hex'),
  WORKSHOP_ID: secrets.WORKSHOP_ID || 'local-workshop-01',
  ALLOWED_ORIGINS: 'http://localhost:4173,http://127.0.0.1:4173',
  GROUP_COUNT: '10', WORKSHOP_BUDGET_USD: '40', MAX_CALLS_PER_GROUP: '60', MAX_OUTPUT_TOKENS: '1400'
};
const storage = new LocalStorage(fileURLToPath(new URL('../work/local-store.json', import.meta.url)));
const workshop = new Workshop({ storage }, env);
env.WORKSHOP = { idFromName: x => x, get: () => workshop };

const service = http.createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 22000) { res.writeHead(413); res.end('Request too large'); return; } chunks.push(chunk); }
    const request = new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'The local workshop service could not complete this request.' })); }
});
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const frontend = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(`window.PROMPTING_LAB_CONFIG = ${JSON.stringify({ apiBase: 'http://localhost:8787', groups: 10, creditBudget: 48, workshopBudget: 40 })};`); return; }
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
for (const server of [service, frontend]) server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'A preview port is already in use. Stop the earlier preview first.' : `Could not start the local preview (${error.code || 'unknown error'}).`); process.exitCode = 1; service.close(); frontend.close(); });
await new Promise(r => service.listen(8787, '127.0.0.1', r));
await new Promise(r => frontend.listen(4173, '127.0.0.1', r));
console.log('Prompting Lab: http://localhost:4173');
console.log('Local API status: http://localhost:8787/health');
const configurationIssues = secretConfigurationIssues(env);
if (configurationIssues.length) {
  console.log('Practice mode ready. Fix these settings in .dev.vars to enable live requests:');
  for (const issue of configurationIssues) console.log(`  - ${issue}`);
} else {
  console.log('Workshop configuration passed local checks. Live requests use real API credits.');
}
if (!secrets.WORKSHOP_CODE) console.log('Local development workshop code: local-workshop');
if (!secrets.ADMIN_TOKEN) console.log('Local development facilitator password: local-facilitator');
const alarmTimer = setInterval(() => { workshop.alarm().catch(() => {}); }, 5 * 60000);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(alarmTimer); frontend.close(); service.close(); });
