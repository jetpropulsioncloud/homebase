import { NextRequest, NextResponse } from 'next/server';
import { verifyPlaidWebhook } from '@/lib/plaid';
import { serviceDb } from '@/lib/supabase';
import { syncBankItem } from '@/lib/bank-sync';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:NextRequest) {
  const raw=await req.text();
  if(raw.length>100000) return NextResponse.json({error:'Payload too large'},{status:413});
  const valid=await verifyPlaidWebhook(raw,req.headers.get('plaid-verification'));
  if(!valid) return NextResponse.json({error:'Invalid Plaid signature'},{status:401});
  let body:{webhook_type?:string;webhook_code?:string;item_id?:string};
  try { body=JSON.parse(raw); } catch { return NextResponse.json({error:'Invalid JSON'},{status:400}); }
  if(body.webhook_type!=='TRANSACTIONS' || body.webhook_code!=='SYNC_UPDATES_AVAILABLE' || !body.item_id)
    return NextResponse.json({received:true});
  const {data:item}=await serviceDb().from('bank_items').select('id').eq('plaid_item_id',body.item_id).maybeSingle();
  if(!item) return NextResponse.json({received:true});
  try { await syncBankItem(item.id);return NextResponse.json({received:true}); }
  catch { return NextResponse.json({error:'Temporary sync failure'},{status:503}); }
}
