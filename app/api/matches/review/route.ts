import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest,memberHousehold } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
export const runtime='nodejs';
export async function POST(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  const householdId=await memberHousehold(user.id);
  const {bill_id,month,decision}=await req.json().catch(()=>({}));
  if(!householdId||!['approve','dismiss'].includes(decision)||typeof bill_id!=='string'||!/^[0-9a-f-]{36}$/i.test(bill_id)||typeof month!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))
    return NextResponse.json({error:'Invalid request'},{status:400});
  const db=serviceDb();
  const {data:bill}=await db.from('bills').select('id').eq('id',bill_id).eq('household_id',householdId).maybeSingle();
  if(!bill) return NextResponse.json({error:'Bill not in your household'},{status:403});
  const {data:payment}=await db.from('bill_payments').select('match_id,status').eq('bill_id',bill_id).eq('month',month).maybeSingle();
  if(!payment || payment.status!=='review'||!payment.match_id)
    return NextResponse.json({error:'No payment suggestion to review'},{status:404});
  const {data:match}=await db.from('payment_matches').select('id,status').eq('id',payment.match_id).eq('bill_id',bill_id).eq('month',month).maybeSingle();
  if(!match || match.status!=='suggested') return NextResponse.json({error:'Match no longer reviewable'},{status:409});
  const status=decision==='approve'?'confirmed':'dismissed';
  const {error:e1}=await db.from('payment_matches').update({status}).eq('id',match.id);
  if(e1) return NextResponse.json({error:'Unable to update match'},{status:500});
  const {error:e2}=await db.from('bill_payments').update({
    status:decision==='approve'?'paid':'unpaid',source:'manual',match_id:null,updated_by:user.id,updated_at:new Date().toISOString()
  }).eq('bill_id',bill_id).eq('month',month);
  if(e2) return NextResponse.json({error:'Unable to update bill'},{status:500});
  return NextResponse.json({success:true});
}
