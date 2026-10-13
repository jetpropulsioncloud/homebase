import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
export const runtime='nodejs';
export async function POST(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  const input=await req.json().catch(()=>null);
  const endpoint=input?.endpoint, p256dh=input?.keys?.p256dh, auth_secret=input?.keys?.auth;
  if(typeof endpoint!=='string' || !endpoint.startsWith('https://') || endpoint.length>3000 ||
    typeof p256dh!=='string' || typeof auth_secret!=='string')
    return NextResponse.json({error:'Invalid push subscription'},{status:400});
  const {error}=await serviceDb().from('push_subscriptions').upsert({user_id:user.id,endpoint,p256dh,auth_secret},{onConflict:'endpoint'});
  if(error) return NextResponse.json({error:'Could not save subscription'},{status:500});
  return NextResponse.json({success:true});
}
