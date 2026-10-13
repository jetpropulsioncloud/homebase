import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
export const runtime='nodejs';
export async function GET(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  const {data,error}=await serviceDb().from('bank_items').select('id,institution_name,last_sync_at').eq('user_id',user.id);
  if(error) return NextResponse.json({error:'Could not read bank status'},{status:500});
  return NextResponse.json({items:data||[]});
}
