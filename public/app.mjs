import { STRATEGIES, TOPICS, DEFAULT_TOPIC_ID, MAX_GROUPS, RATING_SCALE, MAX_RATING_TOTAL, EXPERT_ROLES, DEFAULT_ROLE_ID, expertRoleById, MODELS, PRICE_DATE, PRICE_SOURCE, topicById, briefForTopic, instructionsForTopic, strategyForTopic, rubricForTopic, strategyById, estimateBudget, money, validScores } from './shared.mjs';
import { Demo } from './demo.mjs';
import { renderMarkdown } from './markdown.mjs';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const config = window.PROMPTING_LAB_CONFIG || {};
const demo = new Demo();
function readStored(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
const saved = readStored('prompting-lab-session');
const savedAdmin = readStored('prompting-lab-admin');
const state = { mode: saved?.token ? 'live' : 'demo', apiBase: saved?.apiBase || config.apiBase || '', session: saved?.session ?? saved?.participant ?? null, token: saved?.token || '', adminToken: savedAdmin?.token || '', adminBase: savedAdmin?.apiBase || '', view: 'lab', strategyId: 'minimal', model: MODELS[0].id, drafts: readStored('prompting-lab-drafts') || {}, runs: [], group: null, busy: false, admin: null, ratingsDraft: {} };
state.topic = topicById(readStored('prompting-lab-topic')) || topicById();
state.roleId = DEFAULT_ROLE_ID;
const planner = { groups: MAX_GROUPS, calls: 24, inputTokens: 3000, outputTokens: 1400, model: MODELS[0] };
let dialogMode = 'group';
let toastTimer;
let loadingVersion = 0;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast'); el.textContent = message; el.className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 9500 : 4500);
}
function storeSession() { sessionStorage.setItem('prompting-lab-session', JSON.stringify({ apiBase: state.apiBase, token: state.token, session: state.session })); }
function saveDrafts() { sessionStorage.setItem('prompting-lab-drafts', JSON.stringify(state.drafts)); }
function draftKey() {
  const strategyKey = state.strategyId === 'role' ? `role:${state.roleId}` : state.strategyId;
  return state.topic.id === DEFAULT_TOPIC_ID ? strategyKey : `${state.topic.id}:${strategyKey}`;
}
async function api(path, body, admin = false) {
  if (!admin && state.mode === 'demo') return demo.request(path, body, state.topic.id);
  const base = admin ? state.adminBase || state.apiBase : state.apiBase;
  const token = admin ? state.adminToken : state.token;
  if (!base) throw new Error('Connect the workshop service first.');
  let response;
  try { response = await fetch(`${base}${path}?topic=${encodeURIComponent(state.topic.id)}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000), cache: 'no-store' }); }
  catch { throw new Error('Could not reach the workshop service. Check the URL, connection, and allowed website address. If a request was running, refresh your history before trying again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('The service returned an unexpected response. Check the workshop service URL.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function groupLabel(groupId, name) {
  const label = `Group ${String(groupId).padStart(2, '0')}`;
  return name ? `${label} · ${name}` : label;
}

function renderHeader() {
  $('#connection-status').className = `status${state.mode === 'live' ? ' live' : ''}`;
  $('#connection-status').innerHTML = `<i></i>${state.mode === 'live' ? esc(groupLabel(state.session.groupId, state.group?.groupName ?? state.session.groupName)) : 'Practice mode'}`;
  $('#connect-button').textContent = state.mode === 'live' ? 'Connection' : 'Join workshop';
  $('#leave-button').hidden = state.mode !== 'live';
  $('#mode-banner').hidden = state.mode === 'live';
  $('#mode-banner').textContent = 'Practice mode uses sample responses.';
  $('#topic-picker').hidden = state.view === 'budget';
  const topicSelect = $('#topic-select');
  topicSelect.value = state.topic.id;
  topicSelect.disabled = state.busy;
  const activeTab = state.view === 'budget' ? 'facilitator' : state.view;
  $$('.tab').forEach(el => { el.classList.toggle('active', el.dataset.view === activeTab); if (el.dataset.view === activeTab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('#comparison-count').textContent = state.group?.responses?.length ?? (state.mode === 'demo' ? STRATEGIES.length : 0);
}
function strategyCards() {
  return STRATEGIES.map((strategy, index) => {
    const selected = state.strategyId === strategy.id;
    return `<button class="strategy-card${selected ? ' selected' : ''}" data-action="strategy" data-id="${strategy.id}" aria-pressed="${selected}">
      <strong>${index + 1}. ${strategy.tag}</strong><span class="tag">${strategy.name}</span>
    </button>`;
  }).join('');
}

function briefIcon(topic) {
  const shape = topic.id === DEFAULT_TOPIC_ID
    ? '<path d="M3 14c0-3 2.8-5 6-5h3.5a2.6 2.6 0 1 1 4.9 1.3L22 14l-3.2 2.7a5.7 5.7 0 0 1-3.7 1.3H9c-3.3 0-6-1.4-6-4Z"/><path d="M3 15a2 2 0 0 0 0 4h3M17 13h.01"/>'
    : '<path d="M20 4c-8 0-14 3.5-14 9a5 5 0 0 0 5 5c5.5 0 9-6 9-14Z"/><path d="M4 20 15 9"/>';
  return `<svg class="brief-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

function strategyLabel(run) {
  const type = strategyById(run.strategyId)?.tag ?? run.strategyId;
  const role = expertRoleById(run.roleId);
  return role ? `${type} · ${role.name}` : type;
}
function modelOptions(current = state.model, excludedModel) {
  return MODELS.filter(model => model.id !== excludedModel)
    .map(model => `<option value="${model.id}"${current === model.id ? ' selected' : ''}>${model.name}</option>`)
    .join('');
}

function comparisonControls(run) {
  const originalModel = run.requestedModel || run.model;
  return `<label class="model-label">COMPARE WITH
    <select>${modelOptions(state.model, originalModel)}</select>
  </label>
  <button class="button small" data-action="other-model" data-id="${esc(run.id)}" ${state.busy ? 'disabled' : ''}>Run same input →</button>`;
}
function renderLab() {
  const topic = state.topic;
  const strategy = strategyForTopic(state.strategyId, topic, state.roleId);
  const runLabel = state.mode === 'demo' ? 'Load sample response' : 'Run prompt';
  $('#view').innerHTML = `
    <div class="workspace-grid">
      <div class="workspace-main">
        <section aria-labelledby="strategy-title">
          <h2 id="strategy-title">Prompting strategy</h2>
          <div class="strategies">${strategyCards()}</div>
          ${strategy.id === 'role' ? `<label class="expert-role" for="expert-role">Expert role
            <select id="expert-role" ${state.busy ? 'disabled' : ''}>
              ${EXPERT_ROLES.map(role => `<option value="${role.id}" ${role.id === state.roleId ? 'selected' : ''}>${role.name}</option>`).join('')}
            </select>
          </label>` : ''}
        </section>
        <section class="editor-panel" aria-labelledby="prompt-title">
          <div class="section-top">
            <h2 id="prompt-title">Prompt</h2>
            <button class="text-button" data-action="reset-prompt">Reset prompt</button>
          </div>
          <p class="callout" id="prompt-brief-note">The shared research brief is sent with every request, including follow-ups. Refer to it directly in your prompt.</p>
          <label class="sr-only" for="prompt">${strategy.tag} prompt</label>
          <textarea id="prompt" aria-describedby="prompt-brief-note" maxlength="7000" spellcheck="true">${esc(state.drafts[draftKey()] ?? strategy.prompt)}</textarea>
          <div class="editor-actions">
            <label class="model-label">Model<select id="model-select">${modelOptions()}</select></label>
            <button class="button primary" data-action="run" ${state.busy ? 'disabled' : ''}>
              ${state.busy ? '<span class="spinner"></span> Running…' : runLabel}
            </button>
          </div>
          <details class="privacy">
            <summary>See exactly what the model receives</summary>
            <pre class="prompt-context">${esc(instructionsForTopic(topic))}</pre>
            <p>Your prompt follows these instructions. Follow-ups also include earlier messages in the conversation.</p>
          </details>
        </section>
        <section class="history-panel" aria-labelledby="history-title">
          <div class="section-top">
            <h2 id="history-title">Responses</h2>
            <button class="text-button" data-action="refresh-history">Refresh history</button>
          </div>
          <div id="history">${historyMarkup()}</div>
        </section>
      </div>
      <aside class="fact-sheet" aria-labelledby="brief-title">
        <h2 class="brief-heading" id="brief-title">${briefIcon(topic)} Shared research brief</h2>
        <p><strong>${esc(topic.question)}</strong></p>
        <ul>${topic.facts.map(fact => `<li>${esc(fact)}</li>`).join('')}</ul>
        <button class="text-button" data-action="copy-brief">Copy brief</button>
      </aside>
    </div>`;
}
function historyMarkup() {
  const runs = state.runs.filter(r => r.strategyId === state.strategyId).slice().reverse();
  if (!runs.length) return `<div class="empty-state"><p>Run a prompt to see its response here.</p></div>`;
  return runs.map((r, i) => {
    const strategy = strategyForTopic(r.strategyId, state.topic, r.roleId);
    const isShared = state.group?.responses.some(x => x.id === r.id);
    const modelName = MODELS.find(m => m.id === r.model)?.name || r.model;
    const role = expertRoleById(r.roleId);
    const responseLabel = role ? `${modelName} · ${role.name}` : modelName;
    const meta = r.usage ? `${r.usage.input_tokens.toLocaleString()} input / ${r.usage.output_tokens.toLocaleString()} output tokens · ${money(r.costMicros / 1e6, 4)} · ${(r.latencyMs / 1000).toFixed(1)}s` : state.mode === 'demo' ? 'Authored example · No API call or cost' : r.status === 'pending' ? 'Request still running · Refresh shortly' : 'Usage could not be confirmed';
    const content = `<div class="response-panel" data-run="${esc(r.id)}"><div class="section-top"><h3>${r.status === 'pending' ? 'Request in progress' : r.status === 'failed' ? 'Request incomplete' : `Response · turn ${r.turn}`}</h3><span class="badge">${esc(responseLabel)}</span></div>${r.error ? `<div class="callout warning">${esc(r.error)}</div>` : ''}${r.truncated ? '<div class="callout warning">The response reached its token limit and may be unfinished. Consider a shorter requested answer.</div>' : ''}<div class="response-text">${renderMarkdown(r.text)}</div><div class="response-meta">${esc(meta)}</div><details class="privacy"><summary>View prompt and context</summary><pre class="prompt-context">${esc(r.instructions ?? instructionsForTopic(state.topic))}</pre>${r.messages.map(m => `<p><strong>${esc(m.role)}</strong><br>${esc(m.content).replace(/\n/g, '<br>')}</p>`).join('')}</details>${r.status === 'complete' ? `<div class="response-toolbar"><div class="button-row"><button class="button small primary" data-action="publish" data-id="${esc(r.id)}" ${isShared || state.group?.revealed ? 'disabled' : ''}>${isShared ? 'Shared with group ✓' : 'Share for comparison →'}</button>${comparisonControls(r)}<button class="button small" data-action="export-run" data-id="${esc(r.id)}">Export</button></div></div><details class="followup-box" ${i === 0 && ['clarify', 'critique'].includes(strategy.id) ? 'open' : ''}><summary>${strategy.id === 'clarify' ? 'Continue: respond to the questions' : strategy.id === 'critique' ? 'Continue: critique & revise' : 'Continue this conversation'}</summary><label for="followup-${i}" class="sr-only">Follow-up prompt</label><textarea id="followup-${i}" class="followup-input" maxlength="4000">${esc(strategy.followup)}</textarea><div class="button-row top-gap"><button class="button small" data-action="followup" data-id="${esc(r.id)}" ${state.busy ? 'disabled' : ''}>${state.mode === 'demo' ? 'Load follow-up example' : 'Send follow-up'} →</button></div><p class="context-note">Each follow-up includes the shared research brief and the conversation above. Share the final response when you are ready. Extra turns use more time and tokens.</p></details>` : ''}</div>`;
    return i === 0 ? content : `<details><summary class="text-button">Earlier run · ${esc(responseLabel)} · turn ${r.turn}</summary>${content}</details>`;
  }).join('');
}
async function refreshHistory() {
  const version = loadingVersion;
  const data = await api('/mine');
  if (version !== loadingVersion) return;
  state.runs = (data.runs || []).filter(run => (run.topicId ?? DEFAULT_TOPIC_ID) === state.topic.id);
  if (state.view === 'lab') $('#history').innerHTML = historyMarkup();
}
async function execute(messages, model = state.model, roleId = state.roleId) {
  if (state.busy) return;
  if (state.mode === 'live' && state.topic.id !== DEFAULT_TOPIC_ID && state.group?.topicId !== state.topic.id) {
    toast('This topic is still loading. Check the workshop connection and try again.', true);
    return;
  }
  state.busy = true;
  renderHeader();
  renderLab();
  try {
    const response = await api('/run', {
      model, strategyId: state.strategyId, messages, requestId: crypto.randomUUID(),
      ...(state.strategyId === 'role' ? { roleId } : {})
    });
    if (response.run) { state.runs = state.runs.filter(r => r.id !== response.run.id); state.runs.push(response.run); }
    toast(response.run?.status === 'pending' ? 'Request still running. Refresh your history shortly.' : 'Response ready. Inspect it before sharing.');
  } catch (e) { toast(e.message, true); try { await refreshHistory(); } catch { /* Preserve the original request error. */ } }
  finally {
    state.busy = false;
    renderHeader();
    if (state.view === 'lab') { renderLab(); $('#history').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }
}
function ratingMarkup(row) {
  const saved = state.group.ratings?.[row.id];
  const locked = state.group.revealed;
  if (locked && !saved) return '';
  const draft = locked ? saved : state.ratingsDraft[row.id] ?? saved;
  return `<form class="rating-form" data-id="${esc(row.id)}">
    <h4>Rate this response</h4>
    <p class="rating-scale-key">1 Strongly disagree · 3 Neither agree nor disagree · 5 Strongly agree</p>
    ${rubricForTopic(state.topic).map(criterion => `<fieldset class="rating-question" ${locked ? 'disabled' : ''}>
      <legend>${esc(criterion.statement)}</legend>
      <div class="rating-choices">
        ${RATING_SCALE.map(({ value, label }) => `<label class="rating-choice" title="${esc(label)}">
          <input type="radio" name="${criterion.id}" value="${value}" aria-label="${value} · ${esc(label)}" ${draft?.scores?.[criterion.id] === value ? 'checked' : ''} required>
          <span aria-hidden="true">${value}</span>
        </label>`).join('')}
      </div>
    </fieldset>`).join('')}
    ${locked
      ? (saved.evidence ? `<p class="rating-comment"><strong>Comment</strong><br>${esc(saved.evidence)}</p>` : '')
      : `<label class="evidence-label">Comment (optional)<textarea name="evidence" maxlength="2000" placeholder="Add a note or quote from the response…">${esc(draft?.evidence ?? '')}</textarea></label>
         <div class="button-row">
           <button type="button" class="text-button" data-action="capture-quote" data-id="${esc(row.id)}">＋ Add selected text</button>
           <button class="button small" type="submit">${saved ? 'Update rating' : 'Save rating'}</button>
         </div>
         <p class="context-note">${saved ? 'Rating saved ✓' : 'Rating pending'}</p>`}
  </form>`;
}

function comparisonCard(row, revealed, bestScore, bestCount) {
  const hasTotal = revealed && Number.isInteger(row.totalScore);
  const highest = hasTotal && row.totalScore === bestScore;
  const model = MODELS.find(item => item.id === row.model)?.name ?? row.model;
  return `<article class="compare-card${highest ? ' highest-score' : ''}" data-response="${esc(row.id)}">
    <div class="section-top">
      <h3>${esc(row.label)}</h3>
      ${hasTotal ? `<div class="score-summary">
        <strong>Total ${row.totalScore} / ${MAX_RATING_TOTAL}</strong>
        ${highest ? `<span class="badge score-badge">${bestCount > 1 ? 'Joint highest score' : 'Highest score'}</span>` : ''}
      </div>` : `<span class="blind-indicator">${revealed ? 'Revealed' : 'Labels hidden'}</span>`}
    </div>
    ${row.truncated ? '<div class="callout warning">This response reached its token limit.</div>' : ''}
    ${revealed ? `<div class="reveal-info">
      <strong>${esc(strategyLabel(row))}</strong>
      ${esc(model)} · ${row.turn || 1} turn${row.turn === 1 ? '' : 's'}
      ${row.usage ? `<br>${row.usage.input_tokens} input / ${row.usage.output_tokens} output tokens · ${money(row.costMicros / 1e6, 4)}` : '<br>Authored teaching example'}
    </div>` : ''}
    <div class="comparison-answer response-text" tabindex="0" aria-label="${esc(row.label)} answer">${renderMarkdown(row.text)}</div>
    ${revealed ? `<details class="submitted-prompt"><summary>See the submitted prompt</summary><p>${esc(row.prompt)}</p></details>` : ''}
    ${ratingMarkup(row)}
  </article>`;
}

function renderCompare() {
  const group = state.group;
  if (!group) {
    $('#view').innerHTML = '<p class="busy"><span class="spinner"></span> Loading group responses…</p>';
    return;
  }
  const rows = group.responses;
  const ratedCount = rows.filter(row => validScores(group.ratings?.[row.id]?.scores)).length;
  const totals = rows.map(row => row.totalScore).filter(Number.isInteger);
  const bestScore = totals.length > 1 ? Math.max(...totals) : null;
  const bestCount = totals.filter(total => total === bestScore).length;
  const groupTitle = state.mode === 'demo' ? 'Practice mode' : groupLabel(group.groupId, group.groupName);
  $('#view').innerHTML = `<div class="compare-top">
    <div>
      <p class="eyebrow">${esc(groupTitle)} / ${group.revealed ? 'IDENTITIES REVEALED' : 'IDENTITIES HIDDEN'}</p>
      <h2>Blind comparison</h2>
      ${group.revealed ? '' : '<p>Score each response before revealing the model and strategy.</p>'}
    </div>
    <div class="button-row">
      <button class="button small" data-action="refresh-group">Refresh responses</button>
      ${state.mode === 'demo' ? '<button class="button small" data-action="reset-demo">Reset practice round</button>' : ''}
    </div>
  </div>
  ${group.revealed && rows.length && !totals.length ? '<p class="callout">This round used the previous rating scale. Start a new round to score on the 1–5 scale.</p>' : ''}
  ${rows.length ? `<div class="compare-grid">
    ${rows.map(row => comparisonCard(row, group.revealed, bestScore, bestCount)).join('')}
  </div>
  ${group.revealed ? '' : `<div class="comparison-footer">
    <p>Ratings saved for ${ratedCount} of ${rows.length} responses.</p>
    <button class="button primary" data-action="reveal" ${ratedCount < rows.length ? 'disabled' : ''}>Reveal strategies, models & scores →</button>
  </div>`}` : '<div class="empty-state"><p>Shared responses for this topic will appear here. Use “Share for comparison” in the workspace.</p></div>'}`;
}

function captureRatingDraft(form) {
  if (state.group?.revealed) return null;
  const fields = new FormData(form);
  const scores = Object.fromEntries(rubricForTopic(state.topic).map(criterion => [criterion.id, Number(fields.get(criterion.id))]));
  const draft = { scores, evidence: String(fields.get('evidence') ?? '') };
  state.ratingsDraft[form.dataset.id] = draft;
  return draft;
}
async function refreshGroup() {
  const version = loadingVersion;
  const group = await api('/group');
  if (version !== loadingVersion) return;
  if ((group.topicId ?? DEFAULT_TOPIC_ID) !== state.topic.id) throw new Error('Update the workshop service to use this research topic.');
  const sameRound = state.group && state.group.round === group.round;
  if (!sameRound) state.ratingsDraft = {};
  state.group = group; renderHeader();
  if (state.view === 'compare') renderCompare();
}
function renderBudget() {
  $('#view').innerHTML = `<div class="section-top"><div><p class="eyebrow">PLAN FOR TEN GROUPS / $48 AVAILABLE</p><h2>Budget planner</h2></div><a class="button small" href="#facilitator">Back to workshop status</a></div><div class="budget-layout"><section class="panel"><h3>Set your workshop assumptions</h3><div class="budget-controls"><label>Groups<input id="plan-groups" type="number" min="1" max="${MAX_GROUPS}" value="${planner.groups}"></label><label>API calls per group<input id="plan-calls" type="number" min="1" max="100" value="${planner.calls}"></label><label>Model<select id="plan-model">${modelOptions(planner.model.id)}</select></label><label>Average input tokens per call<input id="plan-inputTokens" type="number" min="100" max="20000" step="100" value="${planner.inputTokens}"></label><label>Average output tokens per call<input id="plan-outputTokens" type="number" min="100" max="2000" step="100" value="${planner.outputTokens}"></label></div><p class="fine-print">Count each question, follow-up, critique, repeat, and model comparison as a separate call. Input includes the fact sheet, instructions, prompt, and any conversation history. Output tokens include the visible answer and any reasoning tokens.</p><div class="callout warning">This planner estimates token charges. It cannot check your actual OpenAI credit balance, model access, or simultaneous-request limits.</div></section><section class="panel"><span class="eyebrow">ESTIMATED WORKSHOP COST</span><div id="budget-result"></div></section></div><section class="panel budget-scenarios"><h3>What would ten groups cost?</h3><div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Total calls</th>${MODELS.map(model => `<th scope="col">${model.name}</th>`).join('')}</tr></thead><tbody>${[['Core activity', 8], ['Exploration', 24], ['Maximum group allowance', 60]].map(([label, calls]) => `<tr><td>${label} · ${calls} calls/group</td><td>${MAX_GROUPS * calls}</td>${MODELS.map(model => `<td>${money(estimateBudget({ groups: MAX_GROUPS, calls, inputTokens: 3000, outputTokens: 1400, model }).total)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="fine-print">Assumes 3,000 input and 1,400 output tokens per call. Estimates use standard uncached rates. GPT-5.6 Sol is budgeted at pre-promotion rates. Rates checked ${PRICE_DATE}: <a href="${PRICE_SOURCE}" target="_blank" rel="noreferrer">OpenAI pricing</a>. Cloudflare hosting charges, if any, are separate.</p></section>`;
  updateBudget();
}
function updateBudget() {
  const estimate = estimateBudget(planner);
  const credit = config.creditBudget || 48;
  const safeBudget = config.workshopBudget || 40;
  const over = estimate.withContingency > safeBudget;
  $('#budget-result').innerHTML = `<div class="budget-number">${money(estimate.total)}</div><p class="budget-caption">${estimate.requests.toLocaleString()} requests across ${planner.groups} groups</p><progress class="meter" aria-label="Estimated share of available credits" max="${credit}" value="${Math.min(credit, estimate.total)}"></progress><p class="context-note">${(estimate.total / credit * 100).toFixed(1)}% of your ${money(credit)} allowance</p><div class="budget-list"><div><span>Per group</span><strong>${money(estimate.perGroup)}</strong></div><div><span>With 50% contingency</span><strong>${money(estimate.withContingency)}</strong></div><div><span>Configured workshop ceiling</span><strong>${money(safeBudget)}</strong></div><div><span>Credit held back</span><strong>${money(credit - safeBudget)}</strong></div></div><div class="callout ${over ? 'warning' : ''}">${over ? 'This plan exceeds the workshop ceiling with contingency. Reduce calls, shorten responses, or use the lower-cost model.' : 'This plan fits the workshop ceiling with a 50% contingency. Confirm with a pilot before the session.'}</div><p class="fine-print">The live service enforces its own server-side limit (default $40) and 60 calls per group. Changing this planner does not change those limits or your provider balance.</p>`;
}
function renderFacilitator() {
  if (!state.adminToken) {
    $('#view').innerHTML = `<section class="panel admin-empty"><h2>Facilitator access</h2><button class="button primary" data-action="admin-connect">Connect as facilitator →</button></section>`; return;
  }
  const data = state.admin;
  if (!data) { $('#view').innerHTML = '<p class="busy"><span class="spinner"></span> Loading workshop status…</p>'; return; }
  $('#view').innerHTML = `<div class="section-top"><div><p class="eyebrow">LIVE WORKSHOP / FACILITATOR</p><h2>Workshop status</h2><p>Token costs are estimated from reported API usage and configured rates. Requests with uncertain usage retain their conservative estimate.</p></div><button class="text-button" data-action="admin-disconnect">Disconnect facilitator</button></div><div class="admin-metrics"><div class="metric"><span>Estimated spend</span><strong>${money(data.budget.spent, 4)}</strong></div><div class="metric"><span>Reserved for running requests</span><strong>${money(data.budget.reserved, 4)}</strong></div><div class="metric"><span>Workshop spending ceiling</span><strong>${money(data.budget.limit)}</strong></div></div><div class="panel"><div class="section-top"><h3>Group progress</h3><span class="badge${data.budget.paused ? ' orange' : ''}">${data.budget.paused ? 'Requests paused' : 'Requests open'}</span></div><div class="table-wrap"><table><thead><tr><th>Group</th><th>Calls used (all topics)</th><th>Running (all topics)</th><th>Shared</th><th>Comparison</th><th>New round</th></tr></thead><tbody>${data.groups.map(g => `<tr><td>${esc(groupLabel(g.id, g.name))}</td><td>${g.calls} / ${data.settings.maxCallsPerGroup}</td><td>${g.active}</td><td>${g.shared}</td><td>${g.revealed ? 'Revealed' : 'Blind'}</td><td><button class="text-button" data-action="new-round" data-id="${g.id}">Start fresh</button></td></tr>`).join('')}</tbody></table></div><div class="admin-actions"><a class="button" href="#budget">Budget planner</a><button class="button primary" data-action="pause">${data.budget.paused ? 'Resume requests' : 'Pause new requests'}</button><button class="button" data-action="admin-refresh">Refresh status</button><button class="button" data-action="export-all">Export workshop JSON</button></div><p class="fine-print">${data.failedCalls} failed or interrupted call(s). Spending here is a local token-cost ledger, not your OpenAI account balance. Other apps can use the same credits. Check <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">OpenAI usage</a> and <a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noreferrer">rate limits</a> before the workshop.</p><details class="privacy"><summary>Data retention and cleanup</summary><p>The service stores fictional prompts, responses, group names, ratings, and usage. Export before deleting if you want to retain workshop findings. Deleting responses preserves spending and call counts so the financial limit remains in force.</p><button class="button small danger" data-action="delete-data">Delete responses & ratings</button></details></div>`;
}
async function refreshAdmin() {
  const version = loadingVersion;
  const data = await api('/admin/status', undefined, true);
  if (version !== loadingVersion) return;
  state.admin = data;
  if (state.view === 'facilitator') renderFacilitator();
}
async function setView() {
  const version = ++loadingVersion;
  const requested = location.hash.slice(1);
  state.view = ['lab', 'compare', 'budget', 'facilitator'].includes(requested) ? requested : 'lab';
  if (state.view === 'budget' && !state.adminToken) {
    state.view = 'facilitator';
    history.replaceState(null, '', '#facilitator');
  }
  renderHeader();
  if (state.view === 'lab') { renderLab(); try { await Promise.all([refreshHistory(), refreshGroup()]); } catch (e) { if (version === loadingVersion) toast(e.message, true); } }
  if (state.view === 'compare') { renderCompare(); try { await refreshGroup(); } catch (e) { if (version === loadingVersion) { $('#view').innerHTML = `<div class="empty-state"><h3>Could not load group responses.</h3><p>${esc(e.message)}</p><button class="button" data-action="refresh-group">Try again</button></div>`; } } }
  if (state.view === 'facilitator') renderFacilitator();
  if (state.view === 'budget') $('#view').innerHTML = '<p class="busy"><span class="spinner"></span> Checking facilitator access…</p>';
  if (['facilitator', 'budget'].includes(state.view) && state.adminToken) {
    try {
      await refreshAdmin();
      if (version === loadingVersion && state.view === 'budget') renderBudget();
    } catch (error) {
      if (version !== loadingVersion) return;
      toast(error.message, true);
      state.adminToken = '';
      state.admin = null;
      sessionStorage.removeItem('prompting-lab-admin');
      state.view = 'facilitator';
      if (requested === 'budget') history.replaceState(null, '', '#facilitator');
      renderHeader();
      renderFacilitator();
    }
  }
}
function openConnection(mode = 'group') {
  dialogMode = mode;
  $('#connection-form').reset();
  $('#service-url').value = mode === 'admin' ? state.adminBase || state.apiBase || config.apiBase || '' : state.apiBase || config.apiBase || '';
  $('#group-fields').hidden = mode === 'admin'; $('#admin-fields').hidden = mode !== 'admin';
  $('#connection-title').textContent = mode === 'admin' ? 'Facilitator access' : 'Join workshop';
  $('#join-submit').textContent = mode === 'admin' ? 'Connect as facilitator →' : 'Join workshop →';
  $('#connection-error').textContent = '';
  $('#group-select').innerHTML = Array.from({ length: Math.min(MAX_GROUPS, config.groups || MAX_GROUPS) }, (_, i) => `<option value="${i + 1}">Group ${String(i + 1).padStart(2, '0')}</option>`).join('');
  if (state.session?.groupId) $('#group-select').value = String(state.session.groupId);
  $('#connection-dialog').showModal();
}
function validBase(raw) {
  const url = new URL(raw);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an HTTPS service address with no path, query, or credentials. Localhost HTTP is allowed for development.');
  return url.origin;
}
$('#connection-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); $('#join-submit').disabled = true; $('#connection-error').textContent = '';
  try {
    const base = validBase(String(fd.get('apiBase')).trim());
    if (dialogMode === 'admin') {
      const token = String(fd.get('adminToken')).trim();
      if (!token) throw new Error('Enter the facilitator password.');
      const response = await fetch(`${base}/admin/status?topic=${encodeURIComponent(state.topic.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not connect as facilitator.');
      state.adminBase = base; state.adminToken = token; state.admin = data;
      sessionStorage.setItem('prompting-lab-admin', JSON.stringify({ apiBase: base, token }));
      $('#connection-dialog').close(); location.hash = 'facilitator'; await setView();
    } else {
      const groupName = String(fd.get('groupName') ?? '').trim();
      const response = await fetch(`${base}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: String(fd.get('code')), groupId: Number(fd.get('groupId')), groupName }), signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not join the workshop.');
      state.apiBase = base; state.mode = 'live'; state.token = data.token; state.session = data.session ?? data.participant; state.runs = []; state.group = null; state.ratingsDraft = {}; storeSession();
      $('#connection-dialog').close(); location.hash = 'lab'; await setView(); toast('Connected. Choose a strategy and make your prediction.');
    }
    form.reset();
  } catch (e) { $('#connection-error').textContent = e.message === 'Failed to fetch' ? 'Could not reach the service. Check its URL and allowed website address.' : e.message; }
  finally { $('#join-submit').disabled = false; }
});
$('#close-dialog').addEventListener('click', () => $('#connection-dialog').close());
$('#connect-button').addEventListener('click', () => openConnection());
$('#practice-button').addEventListener('click', () => { $('#connection-dialog').close(); leave(); });
const topicSelect = $('#topic-select');
topicSelect.innerHTML = TOPICS.map(topic => `<option value="${topic.id}">${topic.name}</option>`).join('');
topicSelect.addEventListener('change', () => {
  const topic = topicById(topicSelect.value);
  if (state.busy || !topic || topic === state.topic) return;
  state.topic = topic;
  sessionStorage.setItem('prompting-lab-topic', JSON.stringify(topic.id));
  state.runs = [];
  state.group = null;
  state.admin = null;
  state.ratingsDraft = {};
  setView();
});
function leave() { state.mode = 'demo'; state.token = ''; state.session = null; state.runs = []; state.group = null; state.ratingsDraft = {}; sessionStorage.removeItem('prompting-lab-session'); setView(); }
function download(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); } catch { toast('Clipboard access is unavailable. Select and copy the text manually.', true); } }

document.addEventListener('input', event => {
  if (event.target.id === 'prompt') { state.drafts[draftKey()] = event.target.value; saveDrafts(); }
  const form = event.target.closest('.rating-form'); if (form) captureRatingDraft(form);
  if (event.target.id.startsWith('plan-')) {
    const key = event.target.id.slice(5);
    if (key === 'model') planner.model = MODELS.find(m => m.id === event.target.value) || MODELS[0];
    else { const value = Number(event.target.value); if (!Number.isFinite(value) || value < Number(event.target.min) || value > Number(event.target.max)) return; planner[key] = value; }
    updateBudget();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'model-select') state.model = event.target.value;
  if (event.target.id === 'expert-role' && expertRoleById(event.target.value)) {
    state.roleId = event.target.value;
    renderLab();
    $('#expert-role').focus();
  }
  const form = event.target.closest('.rating-form'); if (form) captureRatingDraft(form);
});
document.addEventListener('submit', async event => {
  if (!event.target.matches('.rating-form')) return;
  event.preventDefault(); const form = event.target; const draft = captureRatingDraft(form);
  if (!draft || !validScores(draft.scores)) { toast('Choose a score from 1 to 5 for every statement.', true); return; }
  try { await api('/ratings', { runId: form.dataset.id, ...draft }); delete state.ratingsDraft[form.dataset.id]; await refreshGroup(); toast('Rating saved.'); } catch (e) { toast(e.message, true); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action, id = button.dataset.id;
  try {
    if (action === 'admin-connect') openConnection('admin');
    if (action === 'leave') leave();
    if (action === 'strategy') { state.strategyId = id; renderLab(); }
    if (action === 'reset-prompt') { delete state.drafts[draftKey()]; saveDrafts(); renderLab(); }
    if (action === 'copy-brief') await copy(briefForTopic(state.topic));
    if (action === 'run') { const prompt = $('#prompt').value.trim(); if (!prompt) throw new Error('Write a prompt before running it.'); state.drafts[draftKey()] = prompt; await execute([{ role: 'user', content: prompt }]); }
    if (action === 'followup') { const run = state.runs.find(r => r.id === id); const prompt = button.closest('.followup-box').querySelector('textarea').value.trim(); if (!prompt) throw new Error('Write a follow-up first.'); await execute([...run.messages, { role: 'assistant', content: run.text }, { role: 'user', content: prompt }], run.model === 'Authored practice example' ? state.model : run.model, run.roleId); }
    if (action === 'other-model') {
      const run = state.runs.find(r => r.id === id);
      const otherModel = button.closest('.response-toolbar').querySelector('select').value;
      state.model = otherModel;
      await execute(run.messages, otherModel, run.roleId);
    }
    if (action === 'refresh-history') { await refreshHistory(); toast('History refreshed.'); }
    if (action === 'publish') {
      await api('/publish', { runId: id });
      button.disabled = true;
      button.textContent = 'Shared with group ✓';
      await refreshGroup();
      toast('Added to Blind comparison.');
    }
    if (action === 'export-run') { const run = state.runs.find(r => r.id === id); download('prompting-lab-run.json', { schemaVersion: 1, mode: state.mode, ...run }); }
    if (action === 'refresh-group') { await refreshGroup(); toast('Group responses refreshed.'); }
    if (action === 'capture-quote') {
      const selection = window.getSelection(); const card = button.closest('.compare-card');
      if (!selection?.toString().trim() || !card.querySelector('.comparison-answer').contains(selection.anchorNode)) throw new Error('First select a passage in this response, then choose “Add selected text”.');
      const area = card.querySelector('textarea'); area.value = `${area.value}${area.value ? '\n' : ''}“${selection.toString().trim()}”`.slice(0, 2000); captureRatingDraft(area.closest('form')); toast('Selected text added to your evidence.');
    }
    if (action === 'reveal') {
      if (!confirm('Reveal the models, strategies, and scores? Ratings will lock for this round.')) return;
      await api('/reveal', {}); await refreshGroup(); toast('Strategies, models, and scores revealed.');
    }
    if (action === 'reset-demo') { demo.reset(state.topic.id); state.ratingsDraft = {}; state.group = null; await refreshGroup(); toast('Practice comparison reset.'); }
    if (action === 'admin-refresh') { await refreshAdmin(); toast('Status refreshed.'); }
    if (action === 'pause') { await api('/admin/pause', { paused: !state.admin.budget.paused }, true); await refreshAdmin(); }
    if (action === 'new-round') { if (!confirm(`Start a new ${state.topic.name} comparison for group ${id}? Shared responses and the reveal reset; run history and spending are retained.`)) return; await api('/admin/round', { groupId: Number(id) }, true); await refreshAdmin(); toast('New comparison round started.'); }
    if (action === 'export-all') download('prompting-lab-workshop.json', await api('/admin/export', undefined, true));
    if (action === 'admin-disconnect') { state.adminToken = ''; state.admin = null; sessionStorage.removeItem('prompting-lab-admin'); renderFacilitator(); }
    if (action === 'delete-data') { const confirmation = prompt('Delete all workshop responses and ratings? Export first if needed. Spending is retained. Type DELETE RESPONSES to confirm.'); if (!confirmation) return; const result = await api('/admin/delete', { confirmation }, true); await refreshAdmin(); toast(result.message); }
  } catch (e) { toast(e.message, true); }
});
window.addEventListener('hashchange', setView);
await setView();
