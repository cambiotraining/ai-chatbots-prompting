# Prompting Lab

A life-sciences workshop with five editable prompting strategies, shared group workspaces, blind ratings, and a protected OpenAI Responses API integration.

The interface is a static site ready for **GitHub Pages**. The API and shared workshop state run in a **Cloudflare Worker with one Durable Object per workshop**. No OpenAI key goes into the website or GitHub repository.

## Try it on your computer

Install Node.js 20 or newer, open a terminal in this folder, and run:

```sh
npm install
npm run dev
```

Open **http://localhost:4173**. Practice mode uses authored examples for each topic and works without an API key. The preview copies the Markdown renderer into the site before starting.

The preview also starts the local API on **http://localhost:8787**. Check its configuration at **http://localhost:8787/health**. To join the workshop, open the website on port **4173**. If those ports are in use, stop the earlier preview first. Stop the preview with Ctrl+C.

## Add your API key privately, when you are ready

The real API integration is implemented but has deliberately **not been exercised with a real API key**. You do not need to share your key with anyone.

1. Copy `.dev.vars.example` to `.dev.vars` in this folder.
2. Replace only the `OPENAI_API_KEY` placeholder with your OpenAI **project** API key for local testing. Keep the file on your computer. It is excluded from Git.
3. Restart `npm run dev`.
4. In the website, choose **Join workshop**, use service URL `http://localhost:8787`, select a group number, and enter workshop code `local-workshop`. The group name is optional.
5. For the facilitator view, connect to the same service with password `local-facilitator`.

These two fixed passwords are development defaults only. If you set `WORKSHOP_CODE`, `ADMIN_TOKEN`, and `SESSION_SECRET` in `.dev.vars`, use your own workshop code and facilitator password when connecting. The code and admin token need at least 8 characters each, and the session secret needs at least 32. The local service uses a development workshop ID by default and binds to the loopback interface. Production also requires a private `WORKSHOP_ID`.

Local prompts, ratings, and the spending ledger persist in `work/local-store.json`, which is also excluded from Git. Local development sessions expire when the preview restarts unless you set a persistent `SESSION_SECRET` of at least 32 random characters. A restart does not reset spending.

## Test whether $48 is sufficient

Connect under **Facilitator** and open **Budget planner** from the workshop status page. The same calculation is available in the terminal with:

```sh
npm run budget
```

The planning estimate assumes **10 groups × 24 calls per group = 240 calls**, averaging 3,000 input and 1,400 output tokens per call.

| Model | Estimated total | With 50% contingency |
| --- | ---: | ---: |
| GPT-4.1 | $4.13 | $6.19 |
| GPT-5.6 Sol | $13.68 | $20.52 |
| GPT-6 Luna | $0.24 | $0.36 |

At the default maximum of 60 calls per group (600 total), those assumptions give $10.32 for GPT-4.1, $34.20 for GPT-5.6 Sol, and $0.60 for GPT-6 Luna. You can change the number of groups, calls per group, and token assumptions in the planner.

Input tokens include the shared instructions and any conversation history. Follow-up questions, critiques, revisions, repeat runs, and model comparisons each count as another call. GPT-5.6 Sol and GPT-6 Luna run with low reasoning effort, and their reasoning tokens count toward the output cap and the estimated charge. The planner and spending ledger budget Sol at its pre-promotion rates of $5 per million input tokens and $30 per million output tokens. Check the OpenAI dashboard for actual charges. Rates checked on **9 November 2026**. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

### Run your own small paid pilot

After adding your key locally, you can choose to run:

```sh
npm run pilot
```

This paid pilot sends **at most five requests** through the workshop service. It runs four prompting strategies on GPT-6 Luna, then repeats the minimal prompt on GPT-4.1. It uses a separate pilot ledger with a **$0.25 ceiling**, conservative reservations, and no automatic retries. Usage and timings are saved to `work/pilot-report.json`.

The pilot reports measured input/output tokens, charges estimated from published rates, latency, truncation, and projections for 240 calls. It stops on a provider error. It does not read your account balance, validate forty-person concurrency, or test long follow-up histories. Look at your [OpenAI usage](https://platform.openai.com/usage), credit expiry, and [API rate limits](https://platform.openai.com/settings/organization/limits) separately.

For a workshop rehearsal, use a few browser profiles/devices to join different groups and submit at the same time. Requests use the API organisation's limits, which are separate from having credit available.

### Spending safeguards

- Default workshop ceiling: **$40**, leaving **$8** of your stated allowance outside this app's budget.
- Maximum **60 API calls per group**, **four running calls per group**, and **1,400 output tokens per call** by default.
- Allowlisted models are `gpt-4.1-2025-04-14`, `gpt-5.6-sol`, and `gpt-6-luna`. Model access depends on the OpenAI API project.
- Input conversations are limited to 12,000 UTF-8 bytes and nine messages.
- Each live answer is prompted to aim for about 1,000 characters and fit within 1,500 characters, including Markdown. The app shows complete answers within that limit. If the model exceeds the limit or its answer is interrupted, ask for fewer points and submit again if needed.
- The service transactionally reserves a conservative upper-bound token cost **before** calling OpenAI. Concurrent requests cannot reserve the same remaining budget.
- The reservation is replaced with an estimate based on returned usage and configured rates, including cached input when reported. The lab skips cache writes on GPT-5.6 Sol and GPT-6 Luna. Failed connections retain the conservative estimate because a charge may have occurred.
- Duplicate request identifiers return the existing request instead of making another paid call. There are no automatic paid retries.
- Pausing the workshop blocks new calls; running calls finish. Deleting responses retains spending and call counts.

This is an application ledger, not an account-wide financial guarantee. Usage elsewhere, changing prices, taxes, currency conversion, hosting, and another workshop using a new ledger are outside its scope. Do not rely on an OpenAI project budget notification as a replacement for the app's request gate. Keep the $8 reserve and review your balance yourself.

## Host the protected service

You need your own Cloudflare account and a GitHub repository. The source has not been deployed to either account.

1. Install deployment tools and sign in:

   ```sh
   npm install
   npx wrangler login
   ```

2. Edit `wrangler.toml`:
   - Set `ALLOWED_ORIGINS` to your exact website origin, for example `https://YOUR-NAME.github.io`. Include a custom-domain origin if you use one. **Do not include `/repository-name`**; browser origins do not contain paths.
   - Keep the default `$40` limit, 10 groups, 60 calls/group, and 1,400 output tokens unless your plan calls for something different.

3. Deploy the service:

   ```sh
   npm run worker:deploy
   ```

4. Add production secrets with Wrangler's interactive secret prompts:

   ```sh
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put WORKSHOP_CODE
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put WORKSHOP_ID
   ```

   Enter the values locally. Use a long random facilitator password and a session secret of at least 32 random characters. Use a workshop code of at least eight characters. Keep the values in Cloudflare Worker secrets or your ignored local `.dev.vars` file. The public `wrangler.toml` holds deployment settings. All five secrets must be configured before groups can join.

5. Copy the deployed `https://prompting-lab-api.…workers.dev` URL into `apiBase` in **`public/config.js`**. The URL is public; the secrets are not.

6. Visit the service's `/health` endpoint. It should report `ok: true` and `configured: true`. This checks secret presence, not OpenAI authentication, credit balance, or model access.

## Start a new workshop

1. Open **Facilitator** on the published app and connect with your facilitator password.
2. Select **Export workshop JSON** if you want a copy of the current results.
3. Under **Start a new workshop**, use the generated **New workshop ID** or enter a fresh ID of 1–100 letters, numbers, hyphens or underscores, starting with a letter or number.
4. Enter a **New workshop code** of 8–128 characters, or leave the field blank to keep the current code.
5. Select **Start new workshop** and confirm. All ten groups start with empty histories, names, ratings and comparisons across every activity, and fresh spending and call counters. Give participants the active code so they can join again.
6. Check the new ID and empty group totals in **Workshop status**. Joining a group and inspecting its history uses no OpenAI credits.

Previous workshop data stays stored separately. Export any results you want before switching, as the facilitator view shows the active workshop. IDs already used in this installation are rejected to prevent accidentally reopening earlier data. Starting a new workshop gives it a new application budget counter. Check your remaining OpenAI credits before the next session.

The app stores the active workshop ID privately on the service, and it persists across service restarts and deployments. The Cloudflare `WORKSHOP_ID` secret selects the initial installation and its existing data. Use the facilitator control for subsequent workshops. Changing that secret selects a different installation. Deploy the updated Worker and publish the updated GitHub Pages interface once to enable this control. Local testing with `npm run dev` also supports the control and persists workshops in the ignored local store.

Cloudflare’s `WORKSHOP_CODE` secret provides the initial join code. Once you set a code in the facilitator view, the app uses that code for the new workshop and carries it forward until you enter another. Keep a copy of it before submitting, as the app stores a verification hash.

Cloudflare charges and plan limits are separate from OpenAI credits. Review the available Workers/Durable Objects plan for your account before the workshop.

## Publish the interface on GitHub Pages

1. Put this project in a GitHub repository with the main branch named `main`.
2. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Push the source to `main`, or run the **Publish workshop interface** workflow manually.
4. The workflow builds the browser Markdown renderer into `public/`, checks the source, and runs the tests before publishing `public/`.
5. Open `https://YOUR-NAME.github.io/YOUR-REPOSITORY/` and join the service using your workshop code. Relative asset links support this repository subpath.

Set `apiBase` so groups can open the site and join with their assigned group number and workshop code. Each of the ten group numbers opens one shared workspace. Groups can enter an optional name when joining. Rejoining the same group number restores its history and ratings. Keep your facilitator password separate from the workshop code.

## Run the activity

Choose **Mouse model** or **Drought resistance in plants** in the research topic picker. The selected brief goes with every request, and each topic has its own drafts, responses, ratings, and reveal. Existing mouse-model responses appear under **Mouse model**. The workshop budget and call limits apply across both topics. Model answers render as Markdown in the workspace and comparison view.

The cards are numbered in this order: Zero-shot prompting, Context, Role, Socratic, and Draft + challenge. With **Role**, choose **Field expert** or **Statistician**. The role appears in the editable prompt and is shown with the strategy after reveal.

| Time | Action |
| --- | --- |
| 0–2 min | Join one shared workspace per group, read the brief together, and choose strategies to compare. |
| 2–5 min | Edit and run prompts. Clarification and critique strategies need a follow-up to complete their workflow. |
| 5–9 min | Use **Add to comparison** for the responses the group wants to compare. Agree on ratings for each anonymous answer, with comments or quotes if useful. |
| 9–12 min | Save all ratings; agree as a group; reveal strategies and models. Optionally rerun an exact input on the other model. |
| 12–15 min | Discuss an improvement, a remaining weakness, and a claim needing independent verification. |

Use **one model across the group first** to compare prompting strategies. Change models only when holding the input fixed. The activity compares workflows, so extra turns, extra tokens, and answer length are part of the discussion, not proof that one prompt is universally superior.

Each distinct response a group adds appears in the comparison for the current topic. A comparison can hold up to 12 responses. The comparison starts empty in live mode, and a new practice round starts with one authored example per strategy. The group sees the responses in random order. Labels can shift as responses are added or removed, while ratings stay attached to the same response.

The comparison loads when opened. Use **Refresh responses** to check for updates from another browser. The facilitator can use **Refresh status** for the latest workshop totals.

The group rates four statements on a 1–5 agreement scale for each shared response. Comments are optional. Before reveal, **Reset rating** clears a response’s scores and comment, and **Remove from comparison** also takes the response out of the round while keeping its run in the workspace. Once all ratings are saved, the group can reveal the model, strategy, and total out of 20. When multiple responses are scored, the comparison highlights the highest score, including ties. The round locks after reveal.

The facilitator can start a new comparison round while retaining run history and spending. Earlier ratings remain in the export on their original scale. A round revealed before the scale changed can be rescored by starting a new round and sharing the saved runs again.

### COVID-19 and AI safety

Open the **AI safety** tab for a five-minute exercise based on a fictional NHS sequencing report in England. Have participants choose a task, audience and response format, then run the prompt. Keep the same audience and format as they interpret the surveillance counts, run the refusal simulation, and reframe the question around evidence about an existing variant. Then change one prompt choice and compare the responses.

In live mode, the workshop service builds the two surveillance prompts from the supplied choices and sends them to the selected model under the same budget and group call limits as the other activities. The simulated ChatGPT safety notice stays in the browser in both modes. Practice mode uses authored responses for all three tasks. Deploy the updated Worker alongside the site to enable live runs.

## What is hidden, recorded, and retained

- Before reveal, the service returns only response IDs, anonymous labels, response text, and a truncation flag for the response cards. Reveal adds the model, strategy, prompt, timing, token counts, and total score.
- The group can inspect its shared run history, prompts, context, tokens, and cost. Groups use their assigned number and the workshop code to open their workspace.
- The Cloudflare Durable Object stores prompts, responses, optional group names, ratings, and usage. Session tokens expire after eight hours by default. The browser retains its workshop session token in session storage, and the API key stays on the service.
- Requests explicitly use `store: false` and have no search, file uploads, external tools, or conversation memory. This does **not** replace OpenAI's applicable API data-retention policy or your institution's requirements. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
- Use the fictional scenario only. Do not submit participant health data, patient information, unpublished confidential research, or real animal-procedure details.
- The facilitator can export all runs and ratings as JSON, pause new calls, start a new comparison, and delete stored responses. Exports contain the full shared instructions and conversation history, but no credentials.

## Checks and project layout

```sh
npm run build
npm test
npm run check
```

Tests use simulated OpenAI responses and do not require or read an API key. They cover budget reservations, concurrency, duplicate calls, group separation, blind-response data, rating locks, errors, session signatures, and facilitator controls.

| Path | Purpose |
| --- | --- |
| `public/` | Static GitHub Pages interface; no secrets |
| `public/shared.mjs` | Scenario, strategies, rubric, approved models, and published rate assumptions |
| `worker/` | Protected API, sessions, group state, budget ledger |
| `wrangler.toml` | Production service configuration and Durable Object migration |
| `scripts/preview.mjs` | Local frontend and local API using the same service logic |
| `scripts/pilot.mjs` | Optional paid pilot you run privately |
| `tests/` | Simulated service and accounting tests |
| `.github/workflows/pages.yml` | Checks and GitHub Pages publication |

### Verification status for this first version

Service/accounting checks run against simulated provider responses. **Real OpenAI requests, Cloudflare deployment, and GitHub Pages publication have not been tested.** Browser preview was blocked by this workspace's local network and browser-access restrictions, so visual verification remains to be done locally. The five-request pilot is provided for you to run when ready; no API key is required for the automated checks.

### Troubleshooting

- **Facilitator sign-in fails**: the facilitator password must match the Production `ADMIN_TOKEN` secret on the Worker at the service URL you entered. Group sign-in uses `WORKSHOP_CODE`. If you no longer have the facilitator password, update `ADMIN_TOKEN` in Cloudflare under the Worker’s **Settings → Runtime variables and secrets**, save/deploy the change, then enter that value in **Facilitator access**. Older Worker versions may show “Your workshop session has expired” when a facilitator password is rejected. Starting a new workshop preserves facilitator access.
- **“The facilitator still needs to configure the API key and workshop secrets.”** Check the startup output from `npm run dev`. It names any missing, placeholder, or too-short setting without printing its value. Correct the setting in `.dev.vars` and restart. A `configured: true` response from `/health` confirms the local checks pass. OpenAI verifies the key on the first live request.
- **“Website is not allowed…” / connection error**: check `ALLOWED_ORIGINS`, including `https`, the hostname, and any custom domain. A repository path is not part of an origin.
- **OpenAI 429**: inspect your API credits and per-model limits. Available credits do not guarantee enough simultaneous-request capacity.
- **Model unavailable**: confirm the pinned model is enabled for your API project. If changing the allowlist in `public/shared.mjs`, also update its rates, check supported API parameters, and rerun your pilot.
- **Response incomplete**: request a shorter answer or review the output-token setting. Every follow-up is a separate paid call.
- **Changed workshop secrets**: participants may need to join again. Changing `SESSION_SECRET` invalidates existing signed sessions.
- **Restart after an interrupted request**: the conservative reservation is settled by an alarm. It is intentionally not discarded as if the request were free.

