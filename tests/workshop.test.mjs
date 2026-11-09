import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { Workshop } from '../worker/index.mjs';
import { LocalStorage } from '../scripts/storage.mjs';
import { issueToken, verifyToken, secretConfigurationIssues } from '../worker/security.mjs';
import { MODELS, STRATEGIES, topicById, strategyForTopic, costMicros, estimateBudget, comparisonRows, RUBRIC } from '../public/shared.mjs';

const usage = { input_tokens: 700, input_tokens_details: { cached_tokens: 100 }, output_tokens: 500 };
function fixture(overrides = {}) {
  const env = { OPENAI_API_KEY: 'test-key-never-sent', WORKSHOP_CODE: 'test-workshop', ADMIN_TOKEN: 'test-facilitator-password', SESSION_SECRET: 'test-session-secret-at-least-32-characters', WORKSHOP_ID: 'test-workshop-01', GROUP_COUNT: '10', WORKSHOP_BUDGET_USD: '40', MAX_CALLS_PER_GROUP: '60', MAX_OUTPUT_TOKENS: '1400', ALLOWED_ORIGINS: 'https://example.github.io', ...overrides };
  const storage = new LocalStorage();
  const workshop = new Workshop({ storage }, env);
  let calls = 0;
  workshop.fetchOpenAI = async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.ok(body.instructions.includes('LX-17'));
    assert.equal(body.max_output_tokens, 1400);
    return new Response(JSON.stringify({ id: `resp_test_${calls}`, model: body.model, status: 'completed', usage, output: [{ type: 'message', content: [{ type: 'output_text', text: 'A study proposal. Randomise allocation and identify the missing evidence.' }] }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  env.WORKSHOP = { idFromName: x => x, get: () => workshop };
  const request = (path, body, token, extraHeaders = {}) => new Request(`https://workshop.example${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const send = async (path, body, token) => { const response = await workshop.fetch(request(path, body, token)); return { status: response.status, ...await response.json() }; };
  const join = async (groupId = 1, groupName = '') => send('/join', { code: env.WORKSHOP_CODE, groupId, groupName });
  const prompt = (options = {}) => ({ model: MODELS[0].id, strategyId: STRATEGIES[0].id, messages: [{ role: 'user', content: STRATEGIES[0].prompt }], requestId: crypto.randomUUID(), ...options });
  return { env, storage, workshop, send, join, prompt, request, get calls() { return calls; } };
}

test('AI safety live runs only send server-built surveillance prompts', async () => {
  const f = fixture({ MAX_CALLS_PER_GROUP: '3' });
  const sent = [];
  f.workshop.fetchOpenAI = async (_url, request) => {
    sent.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ status: 'completed', usage, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Review the sample selection.' }] }] }));
  };
  const { token } = await f.join();
  const path = '/ai-safety/run';
  const choices = { task: 'summarise', audience: 'public', format: 'bullets', requestId: crypto.randomUUID() };
  const extraText = 'Free text supplied by the client.';
  const retiredModel = 'gpt-4.1-mini-2025-04-14';

  assert.equal((await f.send(path, choices)).status, 401);
  for (const invalid of [{ task: 'refusal' }, { audience: extraText }, { format: extraText }, { model: retiredModel }]) {
    assert.equal((await f.send(path, { ...choices, ...invalid }, token)).status, 400);
  }
  assert.equal((await f.send('/run', f.prompt({ model: retiredModel }), token)).status, 400);
  assert.equal((await f.send('/run?topic=covid-surveillance', f.prompt(), token)).status, 400);
  assert.equal(sent.length, 0);
  assert.equal((await f.send('/config', undefined, token)).budget.calls, 0);

  const summary = await f.send(path, { ...choices, messages: [{ role: 'user', content: extraText }] }, token);
  assert.equal(summary.status, 200);
  assert.equal(summary.run.topicId, 'covid-surveillance');
  assert.equal(sent[0].model, MODELS[0].id);
  assert.match(sent[0].instructions, /England.*NHS sites/);
  assert.deepEqual(sent[0].input, [{ role: 'user', content: summary.run.prompt }]);
  assert.match(summary.run.prompt, /Calculate the share.*members of the public.*short bullet points/);
  assert.ok(!JSON.stringify(sent[0]).includes(extraText));

  for (const model of ['gpt-5.6-sol', 'gpt-6-luna']) {
    const reframe = await f.send(path, { ...choices, task: 'reframe', format: 'paragraph', model, requestId: crypto.randomUUID() }, token);
    assert.equal(reframe.status, 200);
    assert.equal(reframe.run.model, model);
    assert.equal(sent.at(-1).model, model);
    assert.match(sent.at(-1).input[0].content, /already circulating Variant A.*one short paragraph/);
  }
  assert.equal((await f.send(path, { ...choices, requestId: crypto.randomUUID() }, token)).status, 429);
  assert.equal(sent.length, 3);
  assert.equal((await f.send('/mine', undefined, token)).runs.length, 0);
});

test('cost calculations include cached input and match the ten-group planning example', () => {
  assert.equal(costMicros(MODELS[0], usage), 5250);
  assert.equal(estimateBudget().requests, 240);
  assert.ok(Math.abs(estimateBudget().total - 4.128) < 1e-8);
  assert.ok(Math.abs(estimateBudget({ model: MODELS[1] }).total - 13.68) < 1e-8);
});
test('Sol and Luna use the same brief and output cap, with low reasoning and model-specific cost estimates', async () => {
  const f = fixture();
  const { token } = await f.join();
  const expectedCosts = { 'gpt-5.6-sol': 18500, 'gpt-6-luna': 320 };
  for (const [model, expectedCost] of Object.entries(expectedCosts)) {
    const prompt = f.prompt({ model });
    let upstreamBody;
    f.workshop.fetchOpenAI = async (_url, request) => {
      upstreamBody = JSON.parse(request.body);
      return Response.json({
        model,
        status: 'completed',
        usage: { input_tokens: 700, output_tokens: 500, output_tokens_details: { reasoning_tokens: 200 } },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A high-level study proposal.' }] }]
      });
    };
    const response = await f.send('/run', prompt, token);
    assert.equal(response.status, 200);
    assert.equal(upstreamBody.model, model);
    assert.match(upstreamBody.instructions, /SHARED SCENARIO\n.*LX-17/);
    assert.deepEqual(upstreamBody.input, prompt.messages);
    assert.deepEqual(upstreamBody.reasoning, { effort: 'low' });
    assert.deepEqual(upstreamBody.prompt_cache_options, { mode: 'explicit' });
    assert.equal(upstreamBody.service_tier, 'default');
    assert.equal(upstreamBody.max_output_tokens, 1400);
    assert.equal(response.run.costMicros, expectedCost);
  }
});
test('session signatures reject tampering, expiry and another workshop without exposing its ID', async () => {
  const secret = 'test-secret-32-characters-long-enough';
  const payload = { exp: 200, groupId: 1 };
  const token = await issueToken(payload, secret, 'one');
  assert.deepEqual(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')), payload);
  assert.ok(await verifyToken(token, secret, 'one', 100));
  assert.equal(await verifyToken(token, secret, 'two', 100), null);
  assert.equal(await verifyToken(token, secret, 'one', 201), null);
  assert.equal(await verifyToken(`${token.slice(0, -2)}xx`, secret, 'one', 100), null);
});

test('public health and join responses keep the workshop ID private and support initial setup', async () => {
  const f = fixture();
  const joined = await f.join();
  assert.equal(joined.status, 200);
  assert.doesNotMatch(JSON.stringify(joined.session), /workshopId/);
  const decoded = JSON.parse(Buffer.from(joined.token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(Object.hasOwn(decoded, 'workshopId'), false);
  const health = await worker.fetch(f.request('/health'), f.env);
  assert.deepEqual(await health.json(), { ok: true, configured: true });

  const unconfigured = { ...f.env, WORKSHOP_ID: undefined, WORKSHOP: undefined };
  const setupHealth = await worker.fetch(f.request('/health'), unconfigured);
  assert.deepEqual(await setupHealth.json(), { ok: true, configured: false });
  const setupJoin = await worker.fetch(f.request('/join', { code: f.env.WORKSHOP_CODE, groupId: 1 }), unconfigured);
  assert.equal(setupJoin.status, 503);
});
test('join validates the code and group; protected routes reject anonymous requests', async () => {
  const f = fixture({ GROUP_COUNT: '30' });
  assert.equal((await f.send('/join', { code: 'incorrect', groupId: 1 })).status, 401);
  assert.equal((await f.join(11)).status, 400);
  const unnamed = await f.send('/join', { code: f.env.WORKSHOP_CODE, groupId: 10 });
  assert.equal(unnamed.status, 200);
  assert.equal(unnamed.settings.groups, 10);
  assert.equal(unnamed.session.groupName, '');
  assert.equal((await f.send('/group')).status, 401);
  assert.equal((await f.send('/health')).configured, true);
});
test('a present API key does not mask invalid workshop secrets in the startup checks or API status', async () => {
  const f = fixture({ WORKSHOP_CODE: '1234', ADMIN_TOKEN: 'replace-with-admin-token', SESSION_SECRET: 'too-short' });
  assert.deepEqual(secretConfigurationIssues(f.env), [
    'WORKSHOP_CODE must be at least 8 characters.',
    'ADMIN_TOKEN is missing or still a placeholder.',
    'SESSION_SECRET must be at least 32 characters.'
  ]);
  const root = await f.send('/');
  assert.equal(root.status, 200);
  assert.equal(root.health, '/health');
  assert.equal(root.configured, false);
  assert.equal((await f.send('/health')).configured, false);
  assert.equal((await f.join()).status, 503);
  assert.equal(f.calls, 0);

  const configured = fixture();
  assert.equal((await configured.send('/')).configured, true);
});
test('CORS only allows the configured website origin, including preflights', async () => {
  const f = fixture();
  const allowed = await worker.fetch(f.request('/health', undefined, null, { Origin: 'https://example.github.io' }), f.env);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://example.github.io');
  const blocked = await worker.fetch(f.request('/health', undefined, null, { Origin: 'https://attacker.example' }), f.env);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await worker.fetch(new Request('https://workshop.example/run', { method: 'OPTIONS', headers: { Origin: 'https://example.github.io' } }), f.env);
  assert.equal(preflight.status, 204);
});
test('one paid request settles reservations and a duplicate does not call OpenAI again', async () => {
  const f = fixture(), { token } = await f.join();
  const body = f.prompt();
  const first = await f.send('/run', body, token);
  const duplicate = await f.send('/run', body, token);
  assert.equal(first.status, 200); assert.equal(duplicate.status, 200); assert.equal(f.calls, 1);
  const ledger = await f.workshop.ledger();
  assert.equal(ledger.spentMicros, 5250); assert.equal(ledger.reservedMicros, 0); assert.equal(ledger.active[1], 0); assert.equal(ledger.calls[1], 1);
  assert.equal(first.run.messages[0].content, body.messages[0].content);
});
test('budget, model allowlist, conversation size and per-group cap are enforced before payment', async () => {
  const f = fixture({ WORKSHOP_BUDGET_USD: '0.000001' }), { token } = await f.join();
  assert.equal((await f.send('/run', f.prompt(), token)).status, 402);
  assert.equal((await f.send('/run', f.prompt({ model: 'unapproved-expensive-model' }), token)).status, 400);
  assert.equal((await f.send('/run', f.prompt({ messages: [{ role: 'user', content: 'x'.repeat(13000) }] }), token)).status, 413);
  assert.equal(f.calls, 0);
  const capped = fixture({ MAX_CALLS_PER_GROUP: '1' }), session = await capped.join();
  assert.equal((await capped.send('/run', capped.prompt(), session.token)).status, 200);
  assert.equal((await capped.send('/run', capped.prompt(), session.token)).status, 429);
  assert.equal(capped.calls, 1);
  const zero = fixture({ WORKSHOP_BUDGET_USD: '0' }), zeroSession = await zero.join();
  assert.equal((await zero.send('/run', zero.prompt(), zeroSession.token)).status, 402);
  assert.equal(zero.calls, 0);
});
test('parallel requests reserve budget atomically, protecting the limit', async () => {
  const f = fixture({ WORKSHOP_BUDGET_USD: '0.024' }), { token } = await f.join();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.workshop.fetchOpenAI = async () => { await gate; return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'test' }] }], usage })); };
  const first = f.send('/run', f.prompt(), token);
  await new Promise(resolve => setTimeout(resolve, 30));
  const second = await f.send('/run', f.prompt(), token);
  assert.equal(second.status, 402);
  release(); assert.equal((await first).status, 200);
  assert.equal((await f.workshop.ledger()).calls[1], 1);
});
test('rejoining a named group restores its runs and scores while other groups remain separate', async () => {
  const f = fixture();
  const a = await f.join(1, '  Greenhouse team  ');
  const b = await f.join(1);
  const outsider = await f.join(2);
  assert.equal(a.session.groupName, 'Greenhouse team');
  assert.equal(b.session.groupName, 'Greenhouse team');
  const one = await f.send('/run', f.prompt(), a.token);
  const two = await f.send('/run', f.prompt({ strategyId: 'structured' }), b.token);
  const history = await f.send('/mine', undefined, b.token);
  assert.deepEqual(history.runs.map(run => run.id), [one.run.id, two.run.id]);
  assert.deepEqual((await f.send('/mine', undefined, outsider.token)).runs, []);
  assert.equal((await f.send('/publish', { runId: one.run.id }, b.token)).status, 200);
  await f.send('/publish', { runId: two.run.id }, b.token);
  const blind = await f.send('/group', undefined, a.token);
  assert.equal(blind.groupName, 'Greenhouse team');
  assert.equal(blind.responses.length, 2);
  for (const response of blind.responses) assert.deepEqual(Object.keys(response).sort(), ['id', 'label', 'text', 'truncated']);
  assert.equal((await f.send('/group', undefined, outsider.token)).responses.length, 0);
  assert.equal((await f.send('/publish', { runId: one.run.id }, outsider.token)).status, 403);
  assert.equal((await f.send('/reveal', {}, a.token)).status, 400);
  const scores = value => Object.fromEntries(RUBRIC.map(criterion => [criterion.id, value]));
  assert.equal((await f.send('/ratings', { runId: one.run.id, scores: scores(5) }, a.token)).status, 200);
  assert.equal((await f.send('/ratings', { runId: two.run.id, scores: scores(3), evidence: '' }, b.token)).status, 200);
  assert.equal((await f.send('/reveal', {}, b.token)).status, 200);
  const revealed = await f.send('/group', undefined, b.token);
  assert.equal(revealed.revealed, true); assert.equal(revealed.responses[0].model, MODELS[0].id);
  assert.deepEqual(Object.fromEntries(revealed.responses.map(row => [row.id, row.totalScore])), { [one.run.id]: 20, [two.run.id]: 12 });
  assert.equal(revealed.ratings[one.run.id].evidence, '');
  assert.equal((await f.send('/ratings', { runId: one.run.id, scores: Object.fromEntries(RUBRIC.map(r => [r.id, 2])), evidence: 'Changed after reveal.' }, a.token)).status, 409);
});
test('one group can share three runs of the same prompt without creating duplicates on retry', async () => {
  const f = fixture();
  const { token } = await f.join();
  const runs = await Promise.all(MODELS.slice(0, 3).map(model => f.send('/run', f.prompt({ model: model.id }), token)));
  const ids = runs.map(({ run }) => run.id);
  const shares = await Promise.all([...ids, ids[0]].map(runId => f.send('/publish', { runId }, token)));
  assert.ok(shares.every(share => share.status === 200));

  const { responses } = await f.send('/group', undefined, token);
  assert.equal(responses.length, 3);
  assert.deepEqual(responses.map(response => response.id).sort(), ids.sort());
});

test('a group can reveal one shared response after saving four valid scores with no comment', async () => {
  const f = fixture();
  const { token } = await f.join();
  assert.equal((await f.send('/reveal', {}, token)).status, 400);

  const { run } = await f.send('/run', f.prompt(), token);
  await f.send('/publish', { runId: run.id }, token);
  assert.equal((await f.send('/reveal', {}, token)).status, 400);

  const scores = Object.fromEntries(RUBRIC.map(criterion => [criterion.id, 4]));
  assert.equal((await f.send('/ratings', { runId: run.id, scores: { ...scores, question: 0 } }, token)).status, 400);
  assert.equal((await f.send('/ratings', { runId: run.id, scores: { ...scores, bias: 2 } }, token)).status, 400);
  assert.equal((await f.send('/ratings', { runId: run.id, scores }, token)).status, 200);
  assert.equal((await f.send('/reveal', {}, token)).status, 200);
  const group = await f.send('/group', undefined, token);
  assert.equal(group.revealed, true);
  assert.equal(group.responses[0].model, run.model);
  assert.equal(group.responses[0].totalScore, 16);
});

test('expert roles change the perspective in the prompt and stay hidden until reveal', async () => {
  const mouse = topicById();
  const plant = topicById('plant-drought');
  const fieldExpert = strategyForTopic('role', mouse, 'field-expert');
  const statistician = strategyForTopic('role', mouse, 'statistician');
  assert.match(fieldExpert.prompt, /^Act as a preclinical researcher/);
  assert.match(strategyForTopic('role', plant).prompt, /^Act as a plant physiologist/);
  assert.match(statistician.prompt, /^Act as a statistician/);
  assert.equal(fieldExpert.prompt.split('. ').at(-1), statistician.prompt.split('. ').at(-1));

  const f = fixture();
  const { token } = await f.join();
  const request = f.prompt({ strategyId: 'role', roleId: 'statistician', messages: [{ role: 'user', content: statistician.prompt }] });
  assert.equal((await f.send('/run', { ...request, roleId: 'invalid-role' }, token)).status, 400);
  assert.equal(f.calls, 0);
  const response = await f.send('/run', request, token);
  assert.equal(response.status, 200);
  assert.equal(response.run.roleId, 'statistician');
  const { id } = response.run;
  await f.send('/publish', { runId: id }, token);
  const blind = await f.send('/group', undefined, token);
  assert.equal(Object.hasOwn(blind.responses[0], 'roleId'), false);

  const scores = Object.fromEntries(RUBRIC.map(criterion => [criterion.id, 1]));
  await f.send('/ratings', { runId: id, scores, evidence: 'The response addresses random allocation.' }, token);
  await f.send('/reveal', {}, token);
  const revealed = await f.send('/group', undefined, token);
  assert.equal(revealed.responses[0].roleId, 'statistician');
});

test('topics select their own Markdown instructions and keep history and comparisons separate under one call limit', async () => {
  const f = fixture({ MAX_CALLS_PER_GROUP: '3' });
  const { token } = await f.join();
  const mouse = await f.send('/run', f.prompt(), token);
  assert.equal(mouse.run.topicId, 'mouse-model');
  assert.match(mouse.run.instructions, /Always return Markdown/);
  const { topicId, instructions, ...legacyRun } = mouse.run;
  await f.storage.put(`run:${legacyRun.id}`, legacyRun);

  const plantRequests = [];
  f.workshop.fetchOpenAI = async (_url, request) => {
    plantRequests.push(JSON.parse(request.body));
    return Response.json({
      status: 'completed', usage,
      output: [{ type: 'message', content: [{ type: 'output_text', text: '## Study design\n\nCompare the two varieties.' }] }]
    });
  };
  const plantPrompt = f.prompt({ messages: [{ role: 'user', content: 'Compare drought resistance.' }] });
  const plantPath = '?topic=plant-drought';
  const plant = await f.send(`/run${plantPath}`, plantPrompt, token);
  assert.equal(plant.status, 200);
  assert.equal(plant.run.topicId, 'plant-drought');
  assert.match(plantRequests[0].instructions, /Always return Markdown/);
  assert.match(plantRequests[0].instructions, /bean varieties/);
  assert.doesNotMatch(plantRequests[0].instructions, /LX-17/);

  const messages = [...plantPrompt.messages, { role: 'assistant', content: plant.run.text }, { role: 'user', content: 'Which controls matter most?' }];
  const followUp = await f.send(`/run${plantPath}`, f.prompt({ messages }), token);
  assert.equal(followUp.status, 200);
  assert.equal(plantRequests[1].instructions, plantRequests[0].instructions);
  assert.deepEqual(plantRequests[1].input, messages);

  assert.equal((await f.send('/publish', { runId: plant.run.id }, token)).status, 400);
  assert.equal((await f.send('/publish', { runId: mouse.run.id }, token)).status, 200);
  assert.equal((await f.send(`/publish${plantPath}`, { runId: plant.run.id }, token)).status, 200);
  assert.deepEqual((await f.send('/group', undefined, token)).responses.map(response => response.id), [mouse.run.id]);
  assert.deepEqual((await f.send(`/group${plantPath}`, undefined, token)).responses.map(response => response.id), [plant.run.id]);

  const mouseHistory = await f.send('/mine', undefined, token);
  assert.equal(mouseHistory.runs.length, 1);
  assert.equal(mouseHistory.runs[0].topicId, 'mouse-model');
  assert.match(mouseHistory.runs[0].instructions, /LX-17/);
  assert.doesNotMatch(mouseHistory.runs[0].instructions, /Always return Markdown/);
  assert.equal((await f.send(`/mine${plantPath}`, undefined, token)).runs.length, 2);
  assert.equal((await f.send('/run', f.prompt(), token)).status, 429);
});
test('OpenAI errors are sanitised and explicit rejections do not consume the reserved budget', async () => {
  const f = fixture(), { token } = await f.join();
  f.workshop.fetchOpenAI = async () => new Response('secret upstream account details', { status: 401 });
  const result = await f.send('/run', f.prompt(), token);
  assert.equal(result.status, 502); assert.ok(!JSON.stringify(result).includes('secret upstream'));
  assert.equal((await f.workshop.ledger()).reservedMicros, 0); assert.equal((await f.workshop.ledger()).spentMicros, 0);
});
test('connection failures retain conservative spending; stale reservations are reconciled', async () => {
  const f = fixture(), { token } = await f.join();
  f.workshop.fetchOpenAI = async () => { throw new Error('network failure'); };
  const result = await f.send('/run', f.prompt(), token);
  assert.equal(result.status, 504);
  const ledger = await f.workshop.ledger(); assert.equal(ledger.reservedMicros, 0); assert.ok(ledger.spentMicros > 0);
  const stale = { id: 'stale', status: 'pending', groupId: 1, createdAt: new Date(Date.now() - 10 * 60000).toISOString(), reservedMicros: 1000 };
  await f.storage.put('run:stale', stale);
  await f.storage.put('ledger', { ...ledger, reservedMicros: 1000, active: { 1: 1 } });
  await f.workshop.alarm();
  assert.equal((await f.storage.get('run:stale')).status, 'failed');
  assert.equal((await f.workshop.ledger()).reservedMicros, 0);
});
test('facilitator controls require admin access, pause payment, export and delete without resetting spend', async () => {
  const f = fixture(), { token } = await f.join();
  assert.equal((await f.send('/admin/status', undefined, token)).status, 403);
  const run = await f.send('/run', f.prompt(), token);
  assert.equal(run.status, 200);
  assert.equal((await f.send('/admin/pause', { paused: true }, f.env.ADMIN_TOKEN)).status, 200);
  assert.equal((await f.send('/run', f.prompt(), token)).status, 409);
  const exported = await f.send('/admin/export', undefined, f.env.ADMIN_TOKEN);
  assert.equal(exported.runs.length, 1); assert.ok(!JSON.stringify(exported).includes(f.env.OPENAI_API_KEY)); assert.ok(!JSON.stringify(exported).includes(f.env.ADMIN_TOKEN));
  const before = await f.workshop.ledger();
  assert.equal((await f.send('/admin/delete', { confirmation: 'DELETE RESPONSES' }, f.env.ADMIN_TOKEN)).status, 200);
  assert.equal((await f.send('/admin/export', undefined, f.env.ADMIN_TOKEN)).runs.length, 0);
  assert.equal((await f.workshop.ledger()).spentMicros, before.spentMicros);
  assert.equal((await f.workshop.ledger()).calls[1], before.calls[1]);
});
test('comparison utility never mutates order or leaks hidden fields', () => {
  const runs = [{ id: 'one', blindOrder: 2, strategyId: 'secret', model: 'hidden' }, { id: 'two', blindOrder: 1, strategyId: 'secret', model: 'hidden' }];
  assert.equal(comparisonRows(runs)[0].id, 'two'); assert.equal(runs[0].id, 'one'); assert.ok(!JSON.stringify(comparisonRows(runs)).includes('secret'));
});

test('ten groups can each submit four simultaneous requests with consistent accounting', async () => {
  const f = fixture();
  const sessions = await Promise.all(Array.from({ length: 10 }, (_, i) => f.join(i + 1)));
  const results = await Promise.all(sessions.flatMap(session => Array.from({ length: 4 }, () => f.send('/run', f.prompt(), session.token))));
  assert.ok(results.every(r => r.status === 200));
  const ledger = await f.workshop.ledger();
  assert.equal(ledger.spentMicros, 40 * 5250); assert.equal(ledger.reservedMicros, 0);
  for (let g = 1; g <= 10; g++) { assert.equal(ledger.calls[g], 4); assert.equal(ledger.active[g], 0); }
});

test('a new comparison round clears current ratings without deleting the archived ratings or spend', async () => {
  const f = fixture(), a = await f.join(), b = await f.join(1, 'Other');
  const one = await f.send('/run', f.prompt(), a.token), two = await f.send('/run', f.prompt(), b.token);
  await f.send('/publish', { runId: one.run.id }, a.token); await f.send('/publish', { runId: two.run.id }, b.token);
  for (const id of [one.run.id, two.run.id]) await f.send('/ratings', { runId: id, scores: Object.fromEntries(RUBRIC.map(r => [r.id, 1])), evidence: 'Evidence for round one.' }, a.token);
  await f.send('/reveal', {}, a.token);
  const before = (await f.workshop.ledger()).spentMicros;
  await f.send('/admin/round', { groupId: 1 }, f.env.ADMIN_TOKEN);
  await f.send('/publish', { runId: one.run.id }, a.token);
  const group = await f.send('/group', undefined, a.token);
  assert.equal(group.round, 1); assert.equal(group.revealed, false); assert.deepEqual(group.ratings, {});
  assert.equal((await f.workshop.ledger()).spentMicros, before);
  assert.ok(Object.keys((await f.send('/admin/export', undefined, f.env.ADMIN_TOKEN)).ratings).length > 0);
});
