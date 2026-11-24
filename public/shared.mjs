export const PRICE_DATE = '2026-11-09';
export const PRICE_SOURCE = 'https://developers.openai.com/api/docs/pricing';
export const MAX_GROUPS = 10;
export const MAX_SHARED_RESPONSES = 12;
export const MODELS = [
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', input: 2.00, cached: 0.50, output: 8.00 },
  // Use pre-promotion rates for Sol so the workshop budget does not depend on the discount.
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', input: 5.00, cached: 0.50, output: 30.00, reasoningEffort: 'low' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', input: 0.10, cached: 0.01, output: 0.50, reasoningEffort: 'low' }
];
const mouseTopic = {
  id: 'mouse-model',
  name: 'Mouse model',
  fieldExpert: 'a preclinical researcher specialising in mouse disease models',
  question: 'How would you evaluate whether fictional compound LX-17 improves a disease-relevant outcome in an established mouse model?',
  facts: [
    'LX-17 has shown a promising signal in a cell-based assay. No in vivo efficacy evidence is supplied.',
    'A laboratory has access to an established mouse model and a validated functional outcome measure.',
    'The aim is to outline a defensible study and identify the evidence needed before proceeding.',
    'No effect size, variability estimate, pharmacokinetic evidence, tolerability data, or sex-specific evidence is supplied.',
    'This is a fictional educational exercise. Propose a high-level design, without dosing, animal procedures, or invented results.'
  ],
  guidance: 'Do not provide dosing or animal-procedure instructions.'
};

const plantTopic = {
  id: 'plant-drought',
  name: 'Drought resistance in plants',
  fieldExpert: 'a plant physiologist specialising in drought responses',
  question: 'How would you test whether one of two bean varieties maintains growth better when water is limited?',
  facts: [
    'Seedlings of two fictional varieties of the same bean species, A and B, are available in individual pots.',
    'You can give seedlings normal or reduced watering in the same growing room, with matching pots, soil and light.',
    'You can measure plant height and score visible wilting over the course of the experiment.',
    'No data are provided on the relative drought resistance of the varieties, the expected effect size, or plant-to-plant variability.'
  ],
  guidance: 'Keep the experiment suitable for a classroom or small growing room. Explain the limits of generalising from a pot experiment.',
  strategies: {
    minimal: { prompt: 'Using the shared scenario, suggest a simple experiment to compare drought resistance in the two bean varieties.' },
    structured: { prompt: 'We are planning a classroom experiment in a single growing room and want to compare two bean varieties under normal and reduced watering. Using the shared facts, outline a feasible pot experiment. Include a hypothesis, comparison groups, a primary outcome and measurement schedule, and the information needed to justify the number of pots. Explain which conclusions the design could support.' },
    clarify: { prompt: 'Before designing the plant drought experiment, ask up to four questions that could materially change the design. Explain why each question matters. Wait for answers before proposing the experiment.' },
    critique: {
      prompt: 'Draft a simple pot experiment to compare drought resistance in the two bean varieties. State the research question, groups, and outcome.',
      followup: 'Critique your draft. Could differences in starting size, pot position, or watering explain the result? Does the comparison separate overall growth from a response to reduced watering? Revise the design and explain the most important changes.'
    }
  },
  rubric: {
    limits: { name: 'Limits & generalisability', statement: 'The response explains what a pot experiment can establish and what would need further testing.' }
  }
};

export const TOPICS = [mouseTopic, plantTopic];
export const DEFAULT_TOPIC_ID = mouseTopic.id;
export function topicById(id = DEFAULT_TOPIC_ID) { return TOPICS.find(topic => topic.id === id); }

export function briefForTopic(topic) {
  return `${topic.question}\n\n${topic.facts.map(fact => `- ${fact}`).join('\n')}`;
}

export const MAX_ANSWER_CHARACTERS = 1500;
export const ANSWER_LENGTH_INSTRUCTIONS = `Aim for about 1,000 characters and use at most ${MAX_ANSWER_CHARACTERS} characters, including spaces and Markdown. Use one short paragraph or a few short bullets. Prioritise the most useful points. Before submitting, shorten your draft if needed so the entire answer fits and ends with a complete thought.`;
const openingInstructions = 'You are assisting a life-sciences workshop. Use the shared fictional scenario below for every strategy. Respond with a high-level study design or the requested critique/questions.';
const evidenceInstructions = 'Do not invent experimental evidence, references, or numeric justifications.';
const closingInstructions = 'All responses are educational proposals for expert review, not validated protocols. No web search or other tools are available.';
export const LEGACY_MOUSE_INSTRUCTIONS = `${openingInstructions} Keep responses under 500 words. ${evidenceInstructions} ${mouseTopic.guidance} ${closingInstructions}\n\nSHARED SCENARIO\n${briefForTopic(mouseTopic)}`;

export function instructionsForTopic(topic) {
  return `${openingInstructions} ${evidenceInstructions} ${topic.guidance} ${closingInstructions}\n\nAlways return Markdown, including for clarification questions and follow-ups. ${ANSWER_LENGTH_INSTRUCTIONS} Write the Markdown directly and leave the overall answer outside code fences.\n\nSHARED SCENARIO\n${briefForTopic(topic)}`;
}
export const STRATEGIES = [
  {
    id: 'minimal', name: 'Start simple', tag: 'Zero-shot prompting',
    prompt: 'Using the shared scenario, suggest a high-level study design to evaluate LX-17 in the mouse model.',
    followup: 'Identify one important assumption in your proposal and explain what evidence would be needed to check it.'
  },
  {
    id: 'structured', name: 'Give it context', tag: 'Context',
    prompt: 'Our research team is deciding whether a promising cell assay result justifies an in vivo study of LX-17. Using the shared facts, outline a study for that team. Distinguish known facts from assumptions and missing evidence. Include the research question, primary outcome, comparison groups, bias reduction, sample-size justification, limitations, and animal-welfare review.',
    followup: 'Review whether each section is substantively justified by the supplied facts. Revise one weak section and explain why.'
  },
  {
    id: 'role', name: 'Use an expert role', tag: 'Role',
    prompt: 'Using the shared research brief, propose a study design and explain which decisions you would prioritise.',
    followup: 'Which design decision would you revisit first if more evidence became available, and why?'
  },
  {
    id: 'clarify', name: 'Ask before answering', tag: 'Socratic',
    prompt: 'Before proposing a study for the shared LX-17 scenario, ask up to four clarification questions about information that could materially change the design. Explain briefly why each matters. Do not propose the design yet.',
    followup: 'No further evidence is available beyond the shared fact sheet. Now outline a high-level study, making conditional choices where necessary and listing what must be established before proceeding. Do not invent answers to your questions.'
  },
  {
    id: 'critique', name: 'Draft, then challenge', tag: 'Draft + challenge',
    prompt: 'Using the shared LX-17 scenario, draft a concise high-level study proposal. State the research question, main comparisons, outcome, and important design decisions.',
    followup: 'Critically review your draft for unsupported assumptions, confounding, bias, outcome selection, unjustified sample-size claims, and animal-welfare considerations. Identify the three most consequential weaknesses, then provide a revised proposal. Explain which changes matter and why.'
  }
];
export const EXPERT_ROLES = [
  { id: 'field-expert', name: 'Field expert' },
  { id: 'statistician', name: 'Statistician', perspective: 'a statistician specialising in experimental design' }
];
export const DEFAULT_ROLE_ID = EXPERT_ROLES[0].id;
export function expertRoleById(id) { return EXPERT_ROLES.find(role => role.id === id); }
export const RUBRIC = [
  { id: 'question', name: 'Question & comparisons', statement: 'The design addresses the research question with suitable comparisons.' },
  { id: 'assumptions', name: 'Facts & assumptions', statement: 'The response distinguishes supplied facts from assumptions and missing evidence.' },
  { id: 'justification', name: 'Justified decisions', statement: 'The response explains what evidence would justify decisions such as sample size.' },
  { id: 'limits', name: 'Limits & welfare', statement: 'The response identifies important limitations and animal welfare considerations.' }
];
export const RATING_SCALE = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neither agree nor disagree' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' }
];
export const RATING_SCALE_ID = 'likert-5';
export const MAX_RATING_TOTAL = RUBRIC.length * RATING_SCALE.at(-1).value;
export function modelById(id) { return MODELS.find(m => m.id === id); }
export function costMicros(model, usage) {
  const input = usage.input_tokens || 0;
  const cached = Math.min(input, usage.input_tokens_details?.cached_tokens || 0);
  return Math.ceil((input - cached) * model.input + cached * model.cached + (usage.output_tokens || 0) * model.output);
}
export function estimateBudget({ groups = MAX_GROUPS, calls = 24, inputTokens = 3000, outputTokens = 1400, model = MODELS[0] } = {}) {
  const requests = groups * calls;
  const total = requests * (inputTokens * model.input + outputTokens * model.output) / 1e6;
  return { requests, total, perGroup: total / groups, withContingency: total * 1.5 };
}
export function dollars(micros) { return micros / 1e6; }
export function money(amount, digits = 2) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); }
export function strategyById(id) { return STRATEGIES.find(s => s.id === id); }
export function strategyForTopic(id, topic, roleId = DEFAULT_ROLE_ID) {
  const strategy = { ...strategyById(id), ...topic.strategies?.[id] };
  if (id === 'role') {
    const perspective = expertRoleById(roleId)?.perspective ?? topic.fieldExpert;
    strategy.prompt = `Act as ${perspective}. ${strategy.prompt}`;
  }
  return strategy;
}

export function rubricForTopic(topic) {
  return RUBRIC.map(criterion => ({ ...criterion, ...topic.rubric?.[criterion.id] }));
}
export function comparisonRows(runs, revealed = false, ratings = {}) {
  return [...runs].sort((a, b) => a.blindOrder - b.blindOrder).map((run, i) => {
    const row = { id: run.id, label: `Response ${String.fromCharCode(65 + i)}`, text: run.text, truncated: run.truncated || false };
    if (revealed) {
      const scores = ratings[run.id]?.scores;
      const totalScore = validScores(scores) ? RUBRIC.reduce((total, criterion) => total + scores[criterion.id], 0) : null;
      Object.assign(row, { strategyId: run.strategyId, roleId: run.roleId, model: run.model, prompt: run.prompt, messages: run.messages, usage: run.usage, costMicros: run.costMicros, latencyMs: run.latencyMs, createdAt: run.createdAt, turn: run.turn, totalScore });
    }
    return row;
  });
}
export function validScores(scores) {
  return !!scores && Object.keys(scores).length === RUBRIC.length && RUBRIC.every(criterion =>
    Object.hasOwn(scores, criterion.id) && RATING_SCALE.some(option => option.value === scores[criterion.id])
  );
}
