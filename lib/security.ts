import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { serviceDb } from './supabase';

export function encrypt(secret: string) {
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must contain 32 random bytes, base64 encoded');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64');
}
export function decrypt(ciphertext: string) {
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('Encryption key not configured');
  const payload = Buffer.from(ciphertext,'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm',key,payload.subarray(0,12));
  decipher.setAuthTag(payload.subarray(12,28));
  return Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString('utf8');
}
export async function userFromRequest(request: NextRequest) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await serviceDb().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
export async function memberHousehold(userId: string) {
  const { data, error } = await serviceDb().from('memberships').select('household_id').eq('user_id',userId).maybeSingle();
  if (error) throw error;
  return data?.household_id as string | undefined;
}
