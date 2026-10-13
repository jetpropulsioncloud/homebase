import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest,memberHousehold } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
import { syncBankItem } from '@/lib/bank-sync';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  const hid=await memberHousehold(user.id);
  if(!hid) return NextResponse.json({error:'Join a household first'},{status:403});
  const {data:items,error}=await serviceDb().from('bank_items').select('id').eq('user_id',user.id).eq('household_id',hid);
  if(error) return NextResponse.json({error:'Could not read linked accounts'},{status:500});
  const outcome=[];
  for(const item of items||[]) {
    try { outcome.push(await syncBankItem(item.id)); }
    catch(e) { outcome.push({error:String(e)}); }
  }
  return NextResponse.json({accounts:(items||[]).length,results:outcome});
}
