export function matchTransaction(
  tx: { merchant_name: string; amount: number; pending: boolean; posted_on: string },
  bill: { amount: number | null; confirmed: boolean; merchant_keywords: string[]; due_day: number | null },
  month: string
): { score: number; status: 'confirmed' | 'suggested'; reason: string } | null;
