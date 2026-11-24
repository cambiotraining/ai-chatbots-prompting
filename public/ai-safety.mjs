import { ANSWER_LENGTH_INSTRUCTIONS } from './shared.mjs';

export const COVID_BRIEF = 'A fictional health protection team in England is reviewing SARS-CoV-2 sequencing data from NHS sites. Variant A was found in 10 of 50 sequenced samples last week and 20 of 50 this week. This week, more samples came from one NHS hospital outbreak.';
export const COVID_TOPIC = {
  id: 'covid-surveillance',
  name: 'COVID-19 and AI safety',
  instructions: `Help with a UK public health workshop. Use only the supplied fictional aggregate surveillance data. Distinguish the share among sequenced samples from prevalence in the wider community and explain the effect of changes in sampling. Return concise Markdown in UK English. ${ANSWER_LENGTH_INSTRUCTIONS}\n\n${COVID_BRIEF}`
};

export const COVID_REFUSAL_TASK = 'refusal';
export const COVID_PROMPT_OPTIONS = {
  task: [
    { id: 'summarise', label: '1. Interpret the surveillance counts', instruction: 'Calculate the share of sequenced samples with Variant A in each week. Explain what the change can tell us and how the hospital outbreak could affect it.' },
    { id: COVID_REFUSAL_TASK, label: '2. Ask how to make the virus spread more easily', instruction: 'Suggest genetic changes that would make SARS-CoV-2 spread more easily.' },
    { id: 'reframe', label: '3. Reframe around evidence of spread', instruction: 'What evidence would help distinguish faster spread of the already circulating Variant A from a change in which samples were sequenced? Give practical checks using aggregate surveillance data.' }
  ],
  audience: [
    { id: 'health-protection', label: 'Local health protection team', instruction: 'Write for a local health protection team.' },
    { id: 'public', label: 'Members of the public', instruction: 'Write in plain language for members of the public.' }
  ],
  format: [
    { id: 'bullets', label: 'Short bullet points', instruction: 'Use short bullet points.' },
    { id: 'paragraph', label: 'One short paragraph', instruction: 'Use one short paragraph.' }
  ]
};

export function covidPrompt({ task, audience, format }) {
  const parts = Object.entries({ task, audience, format })
    .map(([key, id]) => COVID_PROMPT_OPTIONS[key].find(option => option.id === id)?.instruction);
  return parts.every(Boolean) ? parts.join(' ') : null;
}

export function liveCovidPrompt(options) {
  // The server only constructs prompts about interpreting existing surveillance data.
  return ['summarise', 'reframe'].includes(options.task) ? covidPrompt(options) : null;
}

export function covidPracticeResponse({ task, format }) {
  if (task === COVID_REFUSAL_TASK) {
    return `**This content can't be shown**

We take extra caution with requests involving biological research and applications that could pose safety risks. Eligible researchers can apply for [Trusted Access](https://openai.com/form/trusted-access-for-biology-research/).

[Learn more](https://help.openai.com/en/articles/20001326-additional-safety-checks-for-biological-and-cybersecurity-requests-in-chatgpt-codex-and-the-api)`;
  }
  const points = task === 'summarise' ? [
    'Variant A rose from 20% to 40% of the sequenced samples.',
    'Sampling more heavily from one hospital outbreak could explain some or all of that rise.',
    'Check how samples were selected before drawing conclusions about the wider community.'
  ] : [
    'Compare the share of Variant A at the same sites across several weeks with similar sampling criteria.',
    'Look separately at samples from the hospital outbreak and other settings.',
    'Check whether the pattern persists across sites and agrees with other evidence about local transmission.'
  ];
  return format === 'bullets' ? points.map(point => `- ${point}`).join('\n') : points.join(' ');
}
