import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import crypto from 'node:crypto';

export async function plaidPost<T>(endpoint: string, input: Record<string,unknown>): Promise<T> {
  const origin = process.env.PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) throw new Error('Plaid credentials not configured');
  const response = await fetch(origin + endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type':'application/json', 'PLAID-CLIENT-ID':process.env.PLAID_CLIENT_ID, 'PLAID-SECRET':process.env.PLAID_SECRET },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Plaid error: ' + (data.error_code || response.status));
  return data as T;
}

export async function verifyPlaidWebhook(raw: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  try {
    const { kid, alg } = decodeProtectedHeader(header);
    if (!kid || alg !== 'ES256') return false;
    const response = await plaidPost<{key: Record<string,unknown>}>('/webhook_verification_key/get',{ key_id: kid });
    if (response.key.kid !== kid || response.key.alg !== 'ES256') return false;
    const key = await importJWK(response.key, 'ES256');
    const { payload } = await jwtVerify(header,key, { algorithms: ['ES256'], maxTokenAge:'5 min' });
    if (typeof payload.iat !== 'number' || Math.abs(Date.now()/1000 - payload.iat) > 300) return false;
    const actual = crypto.createHash('sha256').update(raw).digest();
    const claimed = Buffer.from(String(payload.request_body_sha256 || ''),'hex');
    return actual.length === claimed.length && crypto.timingSafeEqual(actual,claimed);
  } catch { return false; }
}
