import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest,memberHousehold,encrypt } from '@/lib/security';
import { serviceDb } from '@/lib/supabase';
import { plaidPost } from '@/lib/plaid';
import { syncBankItem } from '@/lib/bank-sync';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  const householdId=await memberHousehold(user.id);
  if(!householdId) return NextResponse.json({error:'Join a household first'},{status:403});
  const body=await req.json().catch(()=>({}));
  if(typeof body.public_token!=='string' || !body.public_token.startsWith('public-'))
    return NextResponse.json({error:'Invalid public token'},{status:400});
  try {
    const response=await plaidPost<{access_token:string,item_id:string}>('/item/public_token/exchange',{public_token:body.public_token});
    const db=serviceDb();
    // Store the Plaid token encrypted; never return or expose it to client JS.
    const {data:item,error}=await db.from('bank_items').upsert({
      household_id:householdId,user_id:user.id,plaid_item_id:response.item_id,
      access_token_ciphertext:encrypt(response.access_token),institution_name:'Connected bank'
    },{onConflict:'plaid_item_id'}).select('id').single();
    if(error || !item) throw error||new Error('Cannot save account');
    // Plaid may still be fetching initial history: a later webhook will complete sync.
    let initialSync='started';
    try { await syncBankItem(item.id); initialSync='complete'; }
    catch { initialSync='awaiting_bank_data'; }
    return NextResponse.json({success:true,initialSync});
  } catch(e) { return NextResponse.json({error:String(e)},{status:502}); }
}
