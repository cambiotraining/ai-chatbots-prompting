import { STRATEGIES, DEFAULT_TOPIC_ID, DEFAULT_ROLE_ID, MAX_SHARED_RESPONSES, RATING_SCALE_ID, topicById, strategyForTopic, instructionsForTopic, LEGACY_MOUSE_INSTRUCTIONS, comparisonRows, validScores } from './shared.mjs';

// Authored teaching examples, never represented as live or previously generated AI output.
const MOUSE_EXAMPLES = {
  role: {
    'field-expert': `## Study priorities\n\nFirst establish whether the mouse model and functional outcome reflect the part of the disease the compound is meant to affect. Review exposure and tolerability evidence before planning an efficacy study.\n\nIf the evidence supports proceeding, compare LX-17 with a justified control. Use random allocation and blinded assessment, predefine the outcome and time point, and include animal welfare review.`,
    statistician: `## Design and analysis\n\nDefine the primary comparison as the difference in the validated functional outcome between LX-17 and a justified control at a fixed time. Identify the experimental unit and account for any clustering in the design.\n\nPrespecify random allocation, blinded measurement, exclusions, and the handling of missing outcomes. Estimate sample size only after defining a meaningful effect and obtaining a defensible estimate of variability.`
  },
  minimal: `Study outline\n\nCompare LX-17 with an appropriate control in the established mouse model. Measure the validated functional outcome before and after treatment, using a predefined primary time point.\n\nRandomly allocate animals to groups and keep outcome assessment blinded. Consider a healthy reference group if it helps interpret the functional outcome.\n\nUse an initial study to estimate the effect and variability, followed by a suitably powered confirmatory study. Monitor welfare and obtain the appropriate review before proceeding.\n\nA promising result would be an improvement in the functional outcome compared with the control.`,
  structured: `Research question\nDoes LX-17 improve the validated functional outcome relative to an appropriate control in this mouse model?\n\nPrimary outcome and comparisons\nPredefine the functional outcome and assessment time point. The main comparison is LX-17 versus a justified control. A healthy reference group would require a separate scientific rationale.\n\nBias reduction\nUse random allocation, blinded outcome assessment, predefined exclusions, and a plan for handling missing data. Account for relevant baseline differences.\n\nEvidence needed\nNo numerical sample size can be justified from the supplied facts. Specify a meaningful effect, obtain a defensible variability estimate, and choose the analysis before calculating sample size. Tolerability and exposure evidence are prerequisites for deciding whether an efficacy study is ready.\n\nLimits and welfare\nCell-based evidence does not establish in vivo efficacy. Sex, model relevance, humane endpoints, and opportunities for replacement, reduction, and refinement need expert review.`,
  clarify: `Before proposing a study, I would ask:\n\n1. Is there evidence that LX-17 achieves relevant exposure and is tolerated in vivo? Without it, a negative efficacy result may be difficult to interpret and proceeding may be premature.\n\n2. What functional change would be biologically meaningful, and what variability is expected? These inform outcome interpretation and sample-size justification.\n\n3. Which aspects of human disease does the mouse model represent, and what important aspects does it miss? This limits the conclusions.\n\n4. What sex-specific evidence, baseline characteristics, and welfare constraints are relevant? These could affect allocation and feasibility.\n\nThese questions identify gaps; they do not establish that the proposed experiment is ready.`,
  critique: `Three weaknesses to address\n\n1. Readiness: a cell-based signal alone does not justify immediate in vivo efficacy testing. Establish an evidence-based case for exposure, tolerability, and model relevance first.\n\n2. Bias: a broad comparison does not explain allocation, blinding, exclusions, or analysis. Predefine these decisions and identify likely confounders.\n\n3. Justification: neither sample size nor assessment timing can be inferred from the supplied facts. Identify the evidence needed to justify them rather than inventing values.\n\nRevised outline\nDefine a specific efficacy question and the validated functional primary outcome. If the readiness evidence supports proceeding, compare LX-17 with a justified control using random allocation and blinded assessment. Predefine the analysis and exclusions; base sample size on a meaningful effect and defensible variability evidence.\n\nState which decisions remain conditional. Include animal-welfare review and consider whether non-animal work could resolve important uncertainty first.\n\nSelf-critique has improved the proposal's explicitness. It has not independently verified its correctness.`
};
const PLANT_EXAMPLES = {
  role: {
    'field-expert': `## Watering and measurements\n\nGrow both bean varieties under normal and reduced watering. Use consistent pot size, soil, and light, and check that the reduced watering treatment creates a consistent water deficit across pots.\n\nTrack growth from baseline and record wilting on a defined scale. Compare each variety with its own normally watered control before drawing conclusions about drought response.`,
    statistician: `## Comparison and replication\n\nUse a two-by-two design with variety and watering as the two factors. Randomise pots within each variety and balance positions in the growing room. Treat each independently watered pot as a replicate.\n\nAnalyse whether the growth difference between normal and reduced watering varies by variety. Repeated measurements on the same plant help track change over time but share the same experimental unit.`
  },
  minimal: `## Study outline

Grow seedlings of each bean variety under normal and reduced watering. Use several pots per group and measure change in plant height over the same period.

- Keep soil, pots, and light comparable.
- Randomly assign seedlings to watering groups and distribute pots across the growing space.
- Compare how much growth drops under reduced watering for each variety.`,
  structured: `## Hypothesis

Variety A loses less growth under reduced watering than variety B.

| Variety | Watering groups |
| --- | --- |
| A | Normal and reduced |
| B | Normal and reduced |

## Measurements and controls

1. Measure starting height and choose a fixed end date. Use change in height as the **primary outcome** and wilting as a secondary observation.
2. Randomise watering within each variety and spread pots across positions. Use each pot as a replicate and measure each pot consistently.
3. Compare the reduced-versus-normal change between varieties. Use pilot variability and a meaningful effect to plan the number of pots.

The result applies to these varieties under the tested pot conditions.`,
  clarify: `## Questions before designing the experiment

1. **How many seedlings and pots are available?** Replication determines how precisely the two watering responses can be compared.
2. **How will reduced watering be defined?** A consistent water level or schedule makes the treatment reproducible.
3. **What is the available study period?** Duration affects whether growth or wilting is the better primary outcome.
4. **Do light or temperature vary across the room?** Position differences could be mistaken for a watering effect.`,
  critique: `## Main weaknesses

- Comparing the varieties under reduced watering alone could confuse drought resistance with differences in overall growth.
- Assigning one variety to one side of the room could confound variety with light or temperature.
- Repeated measurements on one seedling do not create extra independent replicates.

## Revised design

Use **both watering levels for both varieties**, with multiple independent pots in each group. Measure starting height, randomise watering assignments and pot placement, and apply a consistent measurement schedule. Compare the effect of reduced watering between varieties. Treat wilting as a secondary outcome and discuss how pot conditions limit generalisation.`
};

function exampleFor(topicId, strategyId, roleId) {
  const examples = topicId === DEFAULT_TOPIC_ID ? MOUSE_EXAMPLES : PLANT_EXAMPLES;
  if (strategyId === 'role') return examples.role[roleId] ?? examples.role[DEFAULT_ROLE_ID];
  return examples[strategyId];
}

function fresh(topic) {
  const runs = STRATEGIES.map(({ id }, i) => {
    const roleId = id === 'role' ? DEFAULT_ROLE_ID : undefined;
    const strategy = strategyForTopic(id, topic, roleId);
    return {
      id: `practice-${topic.id}-${id}`,
      groupId: 1, topicId: topic.id, strategyId: id, roleId, model: 'Authored practice example', prompt: strategy.prompt,
      messages: [{ role: 'user', content: strategy.prompt }], text: exampleFor(topic.id, id, roleId), status: 'complete',
      createdAt: new Date().toISOString(), blindOrder: [3, 1, 5, 4, 2][i], turn: 1, usage: null, costMicros: 0
    };
  });
  return { runs, published: runs.map(r => r.id), ratings: {}, revealed: false };
}
export class Demo {
  storageKey(topicId) { return topicId === DEFAULT_TOPIC_ID ? 'prompting-lab-practice-v1' : `prompting-lab-practice-v1:${topicId}`; }
  load(topic) {
    try { return JSON.parse(sessionStorage.getItem(this.storageKey(topic.id))) || fresh(topic); }
    catch { return fresh(topic); }
  }
  save(topic, state) { sessionStorage.setItem(this.storageKey(topic.id), JSON.stringify(state)); }
  reset(topicId) {
    const topic = topicById(topicId);
    this.save(topic, fresh(topic));
  }
  async request(path, body, topicId) {
    const topic = topicById(topicId);
    const state = this.load(topic);
    if (path === '/run') {
      const existing = state.runs.find(r => r.requestId === body.requestId);
      if (existing) return { run: existing };
      const turn = (body.messages.length + 1) / 2;
      const roleId = body.strategyId === 'role' ? body.roleId ?? DEFAULT_ROLE_ID : undefined;
      const strategy = turn > 1 && !roleId ? (body.strategyId === 'clarify' ? 'structured' : 'critique') : body.strategyId;
      const run = { id: crypto.randomUUID(), requestId: body.requestId, groupId: 1, topicId: topic.id, strategyId: body.strategyId, roleId, model: 'Authored practice example', requestedModel: body.model, prompt: body.messages.at(-1).content, messages: body.messages, text: exampleFor(topic.id, strategy, roleId), status: 'complete', blindOrder: Math.random(), turn, createdAt: new Date().toISOString(), usage: null, costMicros: 0, instructions: instructionsForTopic(topic) };
      state.runs.push(run); this.save(topic, state); return { run };
    }
    if (path === '/mine') return { runs: state.runs.filter(r => !r.id.startsWith('practice-')).map(run => ({ ...run, topicId: topic.id, instructions: run.instructions ?? LEGACY_MOUSE_INSTRUCTIONS })) };
    if (path === '/group') {
      const ratings = Object.fromEntries(Object.entries(state.ratings).filter(([, rating]) => rating.scale === RATING_SCALE_ID));
      return { responses: comparisonRows(state.runs.filter(r => state.published.includes(r.id)), state.revealed, ratings), ratings, revealed: state.revealed, groupId: 1, topicId: topic.id, round: 0, budget: { spent: 0, reserved: 0, limit: 40, paused: false, calls: 0 } };
    }
    if (path === '/publish') {
      if (state.revealed) throw new Error('Reset the practice round before sharing another response.');
      const run = state.runs.find(r => r.id === body.runId);
      if (!run) throw new Error('Switch to the response’s research topic before sharing.');
      if (state.published.includes(run.id)) return { ok: true };
      if (state.published.length >= MAX_SHARED_RESPONSES) throw new Error(`This comparison already has ${MAX_SHARED_RESPONSES} shared responses.`);
      state.published.push(run.id); this.save(topic, state); return { ok: true };
    }
    if (path === '/ratings') {
      if (state.revealed) throw new Error('Ratings are locked after reveal.');
      if (!state.published.includes(body.runId)) throw new Error('Share the response before rating it.');
      if (!validScores(body.scores)) throw new Error('Choose a score from 1 to 5 for every statement.');
      state.ratings[body.runId] = { scores: body.scores, evidence: (body.evidence ?? '').trim(), scale: RATING_SCALE_ID, savedAt: new Date().toISOString() };
      this.save(topic, state);
      return { ok: true };
    }
    if (path === '/reveal') {
      if (!state.published.length || !state.published.every(id => validScores(state.ratings[id]?.scores))) throw new Error('Save a rating for every shared response before revealing.');
      state.revealed = true;
      this.save(topic, state);
      return { ok: true };
    }
    return {};
  }
}
