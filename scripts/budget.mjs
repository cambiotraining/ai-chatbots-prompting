import { MODELS, MAX_GROUPS, PRICE_DATE, estimateBudget, money } from '../public/shared.mjs';
console.log(`Prompting Lab budget estimate — pricing checked ${PRICE_DATE}`);
console.log(`${MAX_GROUPS} groups, with 3,000 input and 1,400 output tokens per call.`);
for (const calls of [8, 24, 60]) {
  console.log(`\n${calls} calls/group (${MAX_GROUPS * calls} calls total):`);
  for (const model of MODELS) {
    const estimate = estimateBudget({ calls, model });
    console.log(`  ${model.name}: ${money(estimate.total)}; ${money(estimate.withContingency)} with 50% contingency`);
  }
}
console.log('\nAvailable credit: $48.00. Default service ceiling: $40.00. Default request cap: 60/group.');
console.log('Estimates are not an account-balance check. Run npm run pilot to measure actual usage when a key is configured.');
