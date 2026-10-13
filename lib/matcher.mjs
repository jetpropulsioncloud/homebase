// Pure, deliberately conservative matching logic. A transaction alone is not proof of a paid bill.
const normalize = value => (value || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** @param {{merchant_name:string,amount:number,pending:boolean,posted_on:string}} tx
 * @param {{amount:number|null,confirmed:boolean,merchant_keywords:string[],due_day:number|null}} bill
 * @param {string} month */
export function matchTransaction(tx, bill, month) {
  const merchant = normalize(tx.merchant_name);
  const keywords = bill.merchant_keywords || [];
  if (tx.amount <= 0 || keywords.length === 0) return null;
  if (!keywords.some(k => normalize(k).length >= 4 && merchant.includes(normalize(k)))) return null;
  if (tx.posted_on.substring(0,7) !== month) return null;
  const expected = bill.amount == null ? null : Number(bill.amount);
  const exact = expected !== null && expected > 0 && Math.abs(Number(tx.amount)-expected) <= 0.01;
  let score = 75 + (exact ? 20 : 0);
  if (bill.due_day && Math.abs(Number(tx.posted_on.slice(8,10)) - bill.due_day) <= 7) score += 5;
  // Late-month charges may belong to next month's bill; never auto-clear those.
  const nearMonthEnd = Number(tx.posted_on.slice(8,10)) >= 25;
  const auto = !tx.pending && !nearMonthEnd && exact && bill.confirmed && score >= 95;
  return { score, status: auto ? 'confirmed' : 'suggested', reason: auto ? 'Exact posted amount and merchant match' : 'Verify merchant, amount and billing period' };
}
