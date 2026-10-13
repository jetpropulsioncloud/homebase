import webpush from 'web-push';
import { serviceDb } from './supabase';

async function pushToUser(userId:string, title:string, body:string, tag:string) {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const db = serviceDb();
  const { data: subscriptions } = await db.from('push_subscriptions').select('*').eq('user_id',userId);
  await Promise.all((subscriptions||[]).map(async sub => {
    try {
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},
        JSON.stringify({title,body,tag,url:'/'}), {TTL:86400});
    } catch (e:unknown) {
      const status = (e as {statusCode?:number}).statusCode;
      if (status===404 || status===410) await db.from('push_subscriptions').delete().eq('id',sub.id);
    }
  }));
}
export async function notifyMember(userId:string,householdId:string,title:string,body:string,dedupeKey:string) {
  const db = serviceDb();
  const { data, error } = await db.from('notifications').upsert(
    {user_id:userId,household_id:householdId,title,body,dedupe_key:dedupeKey},
    {onConflict:'user_id,dedupe_key',ignoreDuplicates:true}
  ).select('id');
  if (error) throw error;
  // Only deliver push on first insertion, so webhook retries don't spam.
  if ((data||[]).length) await pushToUser(userId,title,body,dedupeKey);
}
export async function notifyHousehold(householdId:string,title:string,body:string,key:string) {
  const {data: members,error} = await serviceDb().from('memberships').select('user_id').eq('household_id',householdId);
  if(error) throw error;
  await Promise.all((members||[]).map(m=>notifyMember(m.user_id,householdId,title,body,key)));
}
