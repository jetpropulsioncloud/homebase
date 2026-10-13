import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
import { decrypt } from '@/lib/security';
import { plaidPost } from '@/lib/plaid';
import { notifyHousehold } from '@/lib/notifications';
export const runtime='nodejs';
export async function POST(req:NextRequest){
  const user=await userFromRequest(req);
  if(!user)return NextResponse.json({error:'Sign in required'},{status:401});
  const {id}=await req.json().catch(()=>({}));
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid linked account ID'},{status:400});
  const db=serviceDb();
  const {data:item}=await db.from('bank_items').select('*').eq('id',id).eq('user_id',user.id).maybeSingle();
  if(!item)return NextResponse.json({error:'Connection not found'},{status:404});
  try{
    await plaidPost('/item/remove',{access_token:decrypt(item.access_token_ciphertext)});
    const {data:tx}=await db.from('bank_transactions').select('id').eq('bank_item_id',id);
    const ids=(tx||[]).map(r=>r.id);
    if(ids.length){
      const {data:matches}=await db.from('payment_matches').select('bill_id,month,status').in('transaction_id',ids);
      for(const m of matches||[]){
        if(m.status!=='confirmed')continue;
        const {data:payment}=await db.from('bill_payments').select('source').eq('bill_id',m.bill_id).eq('month',m.month).maybeSingle();
        if(payment?.source==='bank_match'){
          await db.from('bill_payments').update({status:'review',source:'bank_suggestion',match_id:null,updated_at:new Date().toISOString()}).eq('bill_id',m.bill_id).eq('month',m.month);
          await notifyHousehold(item.household_id,'Bank disconnected','A bill paid status needs review because its supporting bank link was removed.',`disconnect:${m.bill_id}:${m.month}`);
        }
      }
    }
    const {error}=await db.from('bank_items').delete().eq('id',id).eq('user_id',user.id);
    if(error)throw error;
    return NextResponse.json({success:true});
  }catch(e){return NextResponse.json({error:String(e)},{status:502});}
}
