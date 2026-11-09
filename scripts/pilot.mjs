import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Workshop } from '../worker/index.mjs';
import { LocalStorage } from './storage.mjs';
import { loadEnv } from './env.mjs';
import { MODELS, STRATEGIES, PRICE_DATE, estimateBudget, money } from '../public/shared.mjs';

const secrets = await loadEnv();
if (!secrets.OPENAI_API_KEY || secrets.OPENAI_API_KEY.startsWith('replace-')) {
  console.log('Live pilot not run: no API key is configured.');
  console.log('Copy .dev.vars.example to .dev.vars and set OPENAI_API_KEY. Keep the key out of chat and source control.');
  process.exitCode = 2;
} else {
  const env = { OPENAI_API_KEY: secrets.OPENAI_API_KEY, SESSION_SECRET: randomBytes(32).toString('hex'), WORKSHOP_CODE: randomBytes(16).toString('hex'), ADMIN_TOKEN: randomBytes(16).toString('hex'), WORKSHOP_ID: `pilot-${Date.now()}`, WORKSHOP_BUDGET_USD: '0.25', GROUP_COUNT: '10', MAX_CALLS_PER_GROUP: '60', MAX_OUTPUT_TOKENS: '1400' };
  const workshop = new Workshop({ storage: new LocalStorage() }, env);
  const records = [];
  const send = async (path, body, token) => {
    const response = await workshop.fetch(new Request(`https://pilot.local${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, ...await response.json() };
  };
  console.log('Running at most five paid requests through the workshop service. Pilot ceiling: $0.25. No automatic retries.');
  const { token } = await send('/join', { code: env.WORKSHOP_CODE, groupId: 1 });
  const pilotStrategies = STRATEGIES.filter(strategy => strategy.id !== 'role');
  for (let i = 0; i < 5; i++) {
    const strategy = pilotStrategies[i % pilotStrategies.length];
    const model = i === 4 ? MODELS[1] : MODELS[0];
    const response = await send('/run', { model: model.id, strategyId: strategy.id, messages: [{ role: 'user', content: strategy.prompt }], requestId: crypto.randomUUID() }, token);
    const run = response.run;
    records.push({ model: model.id, strategy: strategy.id, status: response.status, inputTokens: run?.usage?.input_tokens, outputTokens: run?.usage?.output_tokens, costUsd: run?.costMicros / 1e6, latencyMs: run?.latencyMs, truncated: run?.truncated, error: response.error });
    console.log(`${model.name} / ${strategy.tag}: ${run?.usage ? `${run.usage.input_tokens} input, ${run.usage.output_tokens} output; ${money(run.costMicros / 1e6, 4)}` : response.error || 'No usage returned'}`);
    if (response.status !== 200) break;
  }
  const ledger = await workshop.ledger();
  const report = { timestamp: new Date().toISOString(), priceDate: PRICE_DATE, pilotCeilingUsd: 0.25, recordedCostUsd: ledger.spentMicros / 1e6, runs: records, projections: MODELS.map(model => { const valid = records.filter(r => r.model === model.id && r.status === 200 && Number.isFinite(r.costUsd)); const average = valid.length ? valid.reduce((sum, r) => sum + r.costUsd, 0) / valid.length : null; return { model: model.id, sampleCount: valid.length, averageCostUsd: average, tenGroups240CallsUsd: average === null ? null : average * 240, conservativePlanningEstimate: estimateBudget({ model }).total }; }), limitations: ['A five-request smoke test does not establish forty-participant concurrency capacity.', 'Short first-turn prompts do not measure long follow-up histories.', 'Does not read account credit balance. Check the provider dashboard separately.'] };
  const path = fileURLToPath(new URL('../work/pilot-report.json', import.meta.url));
  await mkdir(fileURLToPath(new URL('../work/', import.meta.url)), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Pilot recorded spend: ${money(report.recordedCostUsd, 4)}. Report saved to work/pilot-report.json (ignored by Git).`);
  if (records.length !== 5 || records.some(r => r.status !== 200)) process.exitCode = 1;
}
