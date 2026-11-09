import { MODELS, RUBRIC, RATING_SCALE, RATING_SCALE_ID, PRICE_DATE, TOPICS, DEFAULT_TOPIC_ID, DEFAULT_ROLE_ID, MAX_GROUPS, MAX_SHARED_RESPONSES, LEGACY_MOUSE_INSTRUCTIONS, topicById, instructionsForTopic, rubricForTopic, modelById, strategyById, expertRoleById, costMicros, comparisonRows, validScores } from '../public/shared.mjs';
import { issueToken, verifyToken, equalSecret, isConfigured, readJson } from './security.mjs';
import { COVID_TOPIC, liveCovidPrompt } from '../public/ai-safety.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const integer = (value, fallback, max) => Math.min(max, Math.max(1, Number.parseInt(value, 10) || fallback));
const configurationError = 'The facilitator still needs to configure the API key and workshop secrets.';

function serviceStatus(path, method, env) {
  if (method !== 'GET') return null;
  if (path === '/health') return json({ ok: true, configured: isConfigured(env) });
  if (path === '/') return json({ service: 'Prompting Lab API', configured: isConfigured(env), health: '/health', message: 'Open the Prompting Lab website to join a workshop.' });
  return null;
}

function groupScope(groupId, topicId) {
  // Keep existing group runs and comparisons under their original keys.
  return topicId === DEFAULT_TOPIC_ID ? String(groupId) : `${groupId}:${topicId}`;
}

function groupRatingsKey(scope, round) {
  return `ratings:${scope}:${round || 0}:group`;
}

function runDetails(run) {
  return { ...run, topicId: run.topicId ?? DEFAULT_TOPIC_ID, instructions: run.instructions ?? LEGACY_MOUSE_INSTRUCTIONS };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ error: 'This website is not allowed to connect. Ask the facilitator to check ALLOWED_ORIGINS.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' } });
    try {
      const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
      let result = serviceStatus(path, request.method, env);
      if (!result && !isConfigured(env)) result = json({ error: configurationError }, 503);
      if (!result) {
        const stub = env.WORKSHOP.get(env.WORKSHOP.idFromName(env.WORKSHOP_ID));
        const forwarded = new Request(request);
        forwarded.headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || 'local');
        result = await stub.fetch(forwarded);
      }
      const response = new Response(result.body, result);
      if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      return response;
    } catch { return json({ error: 'The workshop service is unavailable. Please try again shortly.' }, 503); }
  }
};

export class Workshop {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.fetchOpenAI = fetch.bind(globalThis);
    this.joinAttempts = new Map();
  }
  settings() {
    const configuredBudget = Number(this.env.WORKSHOP_BUDGET_USD);
    const budget = Number.isFinite(configuredBudget) ? configuredBudget : 40;
    return { models: MODELS, priceDate: PRICE_DATE, groups: integer(this.env.GROUP_COUNT, MAX_GROUPS, MAX_GROUPS), budgetMicros: Math.round(Math.min(48, Math.max(0, budget)) * 1e6), maxCallsPerGroup: integer(this.env.MAX_CALLS_PER_GROUP, 60, 100), maxOutputTokens: integer(this.env.MAX_OUTPUT_TOKENS, 1400, 2000), sessionHours: integer(this.env.SESSION_HOURS, 8, 24) };
  }
  async ledger(tx = this.storage) { return await tx.get('ledger') || { spentMicros: 0, reservedMicros: 0, calls: {}, active: {}, paused: false, startedAt: new Date().toISOString(), failedCalls: 0 }; }
  async group(scope, tx = this.storage) { return await tx.get(`group:${scope}`) || { ids: [], published: [], revealed: false, round: 0 }; }
  async groupName(groupId) { return await this.storage.get(`group-name:${groupId}`) || ''; }
  async session(request) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (await equalSecret(token, this.env.ADMIN_TOKEN)) return { admin: true };
    const payload = await verifyToken(token, this.env.SESSION_SECRET, this.env.WORKSHOP_ID);
    if (!payload || !Number.isInteger(payload.groupId) || payload.groupId < 1 || payload.groupId > this.settings().groups) fail('Your workshop session has expired. Please join again.', 401);
    return payload;
  }
  publicBudget(ledger) {
    return { spent: ledger.spentMicros / 1e6, reserved: ledger.reservedMicros / 1e6, limit: this.settings().budgetMicros / 1e6, paused: ledger.paused, calls: Object.values(ledger.calls).reduce((a, b) => a + b, 0) };
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';
      const status = serviceStatus(path, request.method, this.env);
      if (status) return status;
      if (!isConfigured(this.env)) fail(configurationError, 503);
      if (path === '/join' && request.method === 'POST') {
        const ip = request.headers.get('X-Client-IP') || 'local';
        const key = `${ip}:${Math.floor(Date.now() / 60000)}`;
        this.joinAttempts.set(key, (this.joinAttempts.get(key) || 0) + 1);
        if (this.joinAttempts.size > 1000) this.joinAttempts = new Map([[key, 1]]);
        if (this.joinAttempts.get(key) > 120) fail('Too many join attempts. Wait one minute and try again.', 429);
        const body = await readJson(request, 2000);
        if (!await equalSecret(body.code, this.env.WORKSHOP_CODE)) fail('That workshop code is not correct.', 401);
        if (!Number.isInteger(body.groupId) || body.groupId < 1 || body.groupId > this.settings().groups) fail('Choose a valid group.');
        const name = typeof body.groupName === 'string' ? body.groupName.trim().slice(0, 32) : '';
        if (name) await this.storage.put(`group-name:${body.groupId}`, name);
        const groupName = name || await this.groupName(body.groupId);
        const payload = { groupId: body.groupId, exp: Date.now() + this.settings().sessionHours * 3600000 };
        const token = await issueToken(payload, this.env.SESSION_SECRET, this.env.WORKSHOP_ID);
        return json({ token, session: { ...payload, groupName }, settings: this.settings() });
      }
      const session = await this.session(request);
      if (path === '/ai-safety/run' && request.method === 'POST') {
        if (session.admin) fail('Join a group to use the workshop tools.', 403);
        const { task, audience, format, model = MODELS[0].id, requestId } = (await readJson(request, 2000)) ?? {};
        const prompt = liveCovidPrompt({ task, audience, format });
        if (!prompt) fail('Choose a surveillance task, audience and format from the exercise.');
        const body = { model, strategyId: 'structured', messages: [{ role: 'user', content: prompt }], requestId };
        return await this.run(body, session, COVID_TOPIC, groupScope(session.groupId, COVID_TOPIC.id));
      }
      const topic = topicById(url.searchParams.get('topic') ?? DEFAULT_TOPIC_ID);
      if (!topic) fail('Choose an available research topic.');
      if (path === '/config' && request.method === 'GET') return json({ ...this.settings(), budget: this.publicBudget(await this.ledger()) });
      if (path.startsWith('/admin/')) {
        if (!session.admin) fail('Facilitator access is required.', 403);
        return await this.adminRoute(path, request, topic);
      }
      if (session.admin) fail('Join a group to use the workshop tools.', 403);
      const scope = groupScope(session.groupId, topic.id);
      if (path === '/run' && request.method === 'POST') return await this.run(await readJson(request), session, topic, scope);
      if (path === '/mine' && request.method === 'GET') {
        const group = await this.group(scope);
        const runs = await this.loadRuns(group.ids);
        return json({ runs: runs.map(runDetails) });
      }
      if (path === '/group' && request.method === 'GET') {
        const group = await this.group(scope);
        const runs = await this.loadRuns(group.published);
        const ratings = await this.storage.get(groupRatingsKey(scope, group.round)) || {};
        return json({ groupId: session.groupId, groupName: await this.groupName(session.groupId), topicId: topic.id, round: group.round || 0, revealed: group.revealed, responses: comparisonRows(runs, group.revealed, ratings), ratings, budget: this.publicBudget(await this.ledger()) });
      }
      if (path === '/publish' && request.method === 'POST') {
        const { runId } = await readJson(request, 1000);
        await this.storage.transaction(async tx => {
          const run = await tx.get(`run:${runId}`);
          if (!run || run.groupId !== session.groupId) fail('You can only share responses from your group.', 403);
          if ((run.topicId ?? DEFAULT_TOPIC_ID) !== topic.id) fail('Switch to the response’s research topic before sharing.');
          if (run.status !== 'complete' || !run.text) fail('Only completed responses can be shared.');
          const group = await this.group(scope, tx);
          if (group.revealed) fail('This comparison has already been revealed. Ask the facilitator to start another round.', 409);
          if (group.published.includes(runId)) return;
          if (group.published.length >= MAX_SHARED_RESPONSES) fail(`This comparison already has ${MAX_SHARED_RESPONSES} shared responses.`);
          group.published.push(runId);
          await tx.put(`group:${scope}`, group);
        });
        return json({ ok: true });
      }
      if (path === '/ratings' && request.method === 'POST') {
        const { runId, scores, evidence = '' } = await readJson(request, 6000);
        if (!validScores(scores)) fail('Choose a score from 1 to 5 for every statement.');
        if (typeof evidence !== 'string' || evidence.length > 2000) fail('Keep the optional comment under 2,000 characters.');
        await this.storage.transaction(async tx => {
          const group = await this.group(scope, tx);
          if (!group.published.includes(runId)) fail('That response is not in your group.', 403);
          if (group.revealed) fail('Ratings are locked after the reveal. Start a new round to rate again.', 409);
          const key = groupRatingsKey(scope, group.round);
          const ratings = await tx.get(key) || {};
          ratings[runId] = { scores, evidence: evidence.trim(), scale: RATING_SCALE_ID, savedAt: new Date().toISOString() };
          await tx.put(key, ratings);
        });
        return json({ ok: true });
      }
      if (path === '/reveal' && request.method === 'POST') {
        await this.storage.transaction(async tx => {
          const group = await this.group(scope, tx);
          if (!group.published.length) fail('Share a response before revealing.');
          const ratings = await tx.get(groupRatingsKey(scope, group.round)) || {};
          if (!group.published.every(id => validScores(ratings[id]?.scores))) fail('Save a rating for every shared response before revealing.');
          group.revealed = true;
          await tx.put(`group:${scope}`, group);
        });
        return json({ ok: true });
      }
      return json({ error: 'This route does not exist.' }, 404);
    } catch (error) { return json({ error: error.status ? error.message : 'Something went wrong. Please try again.', ...(error.code ? { code: error.code } : {}) }, error.status || 500); }
  }
  async loadRuns(ids) { return (await Promise.all(ids.map(id => this.storage.get(`run:${id}`)))).filter(Boolean); }
  async run(body, session, topic, scope) {
    const model = modelById(body.model);
    if (!model || !strategyById(body.strategyId)) fail('Choose an available model and prompting strategy.');
    const roleId = body.strategyId === 'role' ? body.roleId ?? DEFAULT_ROLE_ID : undefined;
    if (roleId !== undefined && !expertRoleById(roleId)) fail('Choose an available expert role.');
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 9 || body.messages.some((m, i) => !m || m.role !== (i % 2 ? 'assistant' : 'user') || typeof m.content !== 'string' || !m.content.trim())) fail('Use a conversation starting and ending with a prompt.');
    if (body.messages.at(-1).role !== 'user') fail('End the conversation with your prompt.');
    const inputBytes = new TextEncoder().encode(JSON.stringify(body.messages)).length;
    if (inputBytes > 12000) fail('This conversation is too long. Start a fresh one or shorten the prompts.', 413);
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{12,80}$/.test(body.requestId)) fail('A valid request identifier is required.');
    const id = `group-${session.groupId}:${body.requestId}`;
    const existing = await this.storage.get(`run:${id}`) ||
      (session.participantId && await this.storage.get(`run:${session.participantId}:${body.requestId}`));
    if (existing) {
      if ((existing.topicId ?? DEFAULT_TOPIC_ID) !== topic.id) fail('This request identifier is already in use for a different topic.', 409);
      return json(this.runResult(existing), existing.status === 'pending' ? 202 : existing.status === 'failed' ? 409 : 200);
    }
    const settings = this.settings();
    const instructions = topic.instructions ?? instructionsForTopic(topic);
    // One token per UTF-8 byte plus a framing margin is deliberately conservative.
    const inputCeiling = inputBytes + new TextEncoder().encode(instructions).length + 1024;
    const reservation = costMicros(model, { input_tokens: inputCeiling, output_tokens: settings.maxOutputTokens });
    const run = { id, requestId: body.requestId, groupId: session.groupId, topicId: topic.id, instructions, strategyId: body.strategyId, ...(roleId ? { roleId } : {}), model: model.id, messages: body.messages, prompt: body.messages.at(-1).content, turn: (body.messages.length + 1) / 2, createdAt: new Date().toISOString(), status: 'pending', reservedMicros: reservation, blindOrder: crypto.getRandomValues(new Uint32Array(1))[0] };
    await this.storage.transaction(async tx => {
      if (await tx.get(`run:${id}`)) fail('This request is already being processed. Refresh your history.', 409);
      const ledger = await this.ledger(tx);
      if (ledger.paused) fail('The facilitator has paused model requests.', 409);
      if (ledger.spentMicros + ledger.reservedMicros + reservation > settings.budgetMicros) fail('The workshop spending limit has been reached. Ask the facilitator to review the budget.', 402);
      if ((ledger.calls[session.groupId] || 0) >= settings.maxCallsPerGroup) fail('Your group has reached its request allowance.', 429);
      if ((ledger.active[session.groupId] || 0) >= 4) fail('Four requests are already running for your group. Wait a moment.', 429);
      ledger.reservedMicros += reservation;
      ledger.calls[session.groupId] = (ledger.calls[session.groupId] || 0) + 1;
      ledger.active[session.groupId] = (ledger.active[session.groupId] || 0) + 1;
      const group = await this.group(scope, tx);
      group.ids.push(id);
      await tx.put('ledger', ledger);
      await tx.put(`group:${scope}`, group);
      await tx.put(`run:${id}`, run);
    });
    // Pending reservations are not silently released: an interrupted paid request may have incurred a charge.
    await this.storage.setAlarm(Date.now() + 5 * 60000);
    const started = Date.now();
    try {
      const modelOptions = model.reasoningEffort ? {
        reasoning: { effort: model.reasoningEffort },
        // Explicit-only caching with no breakpoints avoids cache-write charges.
        prompt_cache_options: { mode: 'explicit' },
        service_tier: 'default'
      } : {};
      const upstream = await this.fetchOpenAI('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, 'X-Client-Request-Id': body.requestId },
        body: JSON.stringify({
          model: model.id,
          instructions,
          input: body.messages,
          max_output_tokens: settings.maxOutputTokens,
          store: false,
          ...modelOptions
        }),
        signal: AbortSignal.timeout(75000)
      });
      if (!upstream.ok) {
        const status = upstream.status;
        // Do not return provider bodies; they can contain account-specific information.
        const message = status === 429 ? 'OpenAI rate or credit limit reached. Check the API balance and limits, then try again.' : status === 401 ? 'The OpenAI API key was rejected. Ask the facilitator to check it.' : status === 404 ? 'This model is not available to this API project. Choose another model.' : 'OpenAI could not complete this request. Try again shortly.';
        await this.settle(id, { status: 'failed', error: message, costMicros: status >= 500 ? reservation : 0, uncertainCharge: status >= 500 });
        return json({ error: message, runId: id }, status === 429 ? 429 : 502);
      }
      const data = await upstream.json();
      const text = (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text' || c.type === 'refusal').map(c => c.text || c.refusal || '').join('\n\n');
      const usage = data.usage;
      const metered = usage && Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 && (!usage.input_tokens_details?.cached_tokens || Number.isSafeInteger(usage.input_tokens_details.cached_tokens) && usage.input_tokens_details.cached_tokens >= 0);
      const actual = metered ? costMicros(model, usage) : reservation;
      const complete = { status: text ? 'complete' : 'failed', text: text.slice(0, 24000), usage: metered ? usage : null, costMicros: actual, uncertainCharge: !metered, latencyMs: Date.now() - started, responseId: data.id, truncated: data.status === 'incomplete', error: text ? null : 'No visible response was returned. The request may still have used tokens.', returnedModel: data.model };
      const settled = await this.settle(id, complete);
      return json(this.runResult(settled), text ? 200 : 502);
    } catch {
      await this.settle(id, { status: 'failed', error: 'The connection ended before usage could be confirmed. A conservative charge has been kept in the budget. Refresh your history before retrying.', costMicros: reservation, uncertainCharge: true, latencyMs: Date.now() - started });
      return json({ error: 'The connection ended before the response arrived. Refresh your history; the budget retains a conservative estimate.', runId: id }, 504);
    }
  }
  runResult(run) { return { run: runDetails(run), ...(run.status === 'failed' ? { error: run.error } : {}) }; }
  async settle(id, result) {
    return this.storage.transaction(async tx => {
      const run = await tx.get(`run:${id}`);
      if (!run || run.status !== 'pending') return run;
      const ledger = await this.ledger(tx);
      ledger.reservedMicros = Math.max(0, ledger.reservedMicros - run.reservedMicros);
      ledger.spentMicros += result.costMicros;
      ledger.active[run.groupId] = Math.max(0, (ledger.active[run.groupId] || 1) - 1);
      if (result.status === 'failed') ledger.failedCalls++;
      if (result.costMicros > run.reservedMicros) ledger.paused = true;
      Object.assign(run, result);
      await tx.put('ledger', ledger);
      await tx.put(`run:${id}`, run);
      return run;
    });
  }
  async alarm() {
    const runs = await this.storage.list({ prefix: 'run:' });
    for (const [key, run] of runs) if (run.status === 'pending' && Date.now() - Date.parse(run.createdAt) > 4 * 60000) await this.settle(key.slice(4), { status: 'failed', error: 'This interrupted request has been closed with its conservative budget estimate.', costMicros: run.reservedMicros, uncertainCharge: true });
    if ([...runs.values()].some(r => r.status === 'pending')) await this.storage.setAlarm(Date.now() + 5 * 60000);
  }
  async adminRoute(path, request, topic) {
    if (path === '/admin/status' && request.method === 'GET') {
      const ledger = await this.ledger();
      const groups = await Promise.all(Array.from({ length: this.settings().groups }, async (_, i) => {
        const id = i + 1;
        const group = await this.group(groupScope(id, topic.id));
        return { id, name: await this.groupName(id), calls: ledger.calls[id] || 0, active: ledger.active[id] || 0, shared: group.published.length, revealed: group.revealed };
      }));
      return json({ topicId: topic.id, settings: this.settings(), budget: this.publicBudget(ledger), groups, failedCalls: ledger.failedCalls });
    }
    if (path === '/admin/pause' && request.method === 'POST') {
      const { paused } = await readJson(request, 1000);
      if (typeof paused !== 'boolean') fail('Provide a valid pause setting.');
      await this.storage.transaction(async tx => { const ledger = await this.ledger(tx); ledger.paused = paused; await tx.put('ledger', ledger); });
      return json({ ok: true });
    }
    if (path === '/admin/round' && request.method === 'POST') {
      const { groupId } = await readJson(request, 1000);
      if (!Number.isInteger(groupId) || groupId < 1 || groupId > this.settings().groups) fail('Choose a valid group.');
      const scope = groupScope(groupId, topic.id);
      await this.storage.transaction(async tx => { const group = await this.group(scope, tx); group.published = []; group.revealed = false; group.round = (group.round || 0) + 1; await tx.put(`group:${scope}`, group); });
      return json({ ok: true });
    }
    if (path === '/admin/export' && request.method === 'GET') {
      const runs = await this.storage.list({ prefix: 'run:' });
      const ratings = await this.storage.list({ prefix: 'ratings:' });
      const groupNames = await this.storage.list({ prefix: 'group-name:' });
      const topics = TOPICS.map(item => ({ id: item.id, name: item.name, instructions: instructionsForTopic(item), rubric: rubricForTopic(item) }));
      topics.push(COVID_TOPIC);
      return json({ schemaVersion: 2, exportedAt: new Date().toISOString(), workshopId: this.env.WORKSHOP_ID, settings: this.settings(), ledger: await this.ledger(), instructions: topics[0].instructions, rubric: RUBRIC, ratingScale: RATING_SCALE, topics, groupNames: Object.fromEntries([...groupNames].map(([key, name]) => [key.slice('group-name:'.length), name])), runs: [...runs.values()].map(runDetails), ratings: Object.fromEntries(ratings) });
    }
    if (path === '/admin/delete' && request.method === 'POST') {
      const { confirmation } = await readJson(request, 1000);
      if (confirmation !== 'DELETE RESPONSES') fail('Enter DELETE RESPONSES to confirm.');
      const ledger = await this.ledger();
      if (Object.values(ledger.active).some(n => n > 0)) fail('Wait for running requests to finish before deleting responses.', 409);
      // Keep spending and call counts so deletion cannot reset the financial limits.
      await this.storage.transaction(async tx => {
        for (const prefix of ['run:', 'ratings:', 'group:']) { const entries = await tx.list({ prefix }); const keys = [...entries.keys()]; for (let i = 0; i < keys.length; i += 128) await tx.delete(keys.slice(i, i + 128)); }
      });
      return json({ ok: true, message: 'Responses and ratings deleted. Spending and call counts retained.' });
    }
    return json({ error: 'This facilitator route does not exist.' }, 404);
  }
}
