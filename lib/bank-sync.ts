import { serviceDb } from './supabase';
import { decrypt } from './security';
import { plaidPost } from './plaid';
import { matchTransaction } from './matcher.mjs';
import { notifyHousehold } from './notifications';

type PlaidTransaction = {
  transaction_id:string; pending_transaction_id?:string|null;
  account_id:string; name:string; merchant_name?:string|null;
  amount:number; date:string; pending:boolean;
};
type SyncResponse = {added:PlaidTransaction[]; modified:PlaidTransaction[]; removed:{transaction_id:string}[]; next_cursor:string; has_more:boolean};

export async function syncBankItem(itemId: string) {
  const db=serviceDb();
  const {data:item,error:itemError}=await db.from('bank_items').select('*').eq('id',itemId).single();
  if (itemError || !item) throw new Error('Bank Item not found');
  const access_token=decrypt(item.access_token_ciphertext);
  const startCursor=item.cursor as string|null;
  let cursor=startCursor || undefined;
  let pages=0, tries=0;
  let added:PlaidTransaction[]=[], modified:PlaidTransaction[]=[], removed:{transaction_id:string}[]=[];
  while(true) {
    let response:SyncResponse;
    try {
      response=await plaidPost<SyncResponse>('/transactions/sync',{access_token, ...(cursor?{cursor}:{}) ,count:500});
    } catch(e) {
      if(String(e).includes('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') && tries++<3) {
        cursor=startCursor || undefined;
        pages=0; added=[]; modified=[]; removed=[];
        continue;
      }
      throw e;
    }
    pages++;
    if(pages>50) throw new Error('Transaction sync exceeded pagination safety limit');
    added.push(...response.added);
    modified.push(...response.modified);
    removed.push(...response.removed);
    cursor=response.next_cursor;
    if(!response.has_more) break;
  }
  // Changes are only persisted after the full cursor batch is available.
  for(const tx of [...added,...modified]) {
    const {error}=await db.from('bank_transactions').upsert({
      bank_item_id:item.id, owner_id:item.user_id,plaid_transaction_id:tx.transaction_id,
      pending_transaction_id:tx.pending_transaction_id||null,
      account_id:tx.account_id, merchant_name:tx.merchant_name||tx.name,
      amount:tx.amount, posted_on:tx.date,pending:tx.pending,updated_at:new Date().toISOString()
    },{onConflict:'plaid_transaction_id'});
    if(error) throw error;
  }
  // Plaid removes pending transactions as their posted replacements arrive;
  // confirmed matches of removed transactions must be revisited.
  if(removed.length) {
    const ids=removed.map(x=>x.transaction_id);
    const {data: disappearing}=await db.from('bank_transactions').select('id').eq('bank_item_id',item.id).in('plaid_transaction_id',ids);
    const disappearanceIds=(disappearing||[]).map(x=>x.id);
    if(disappearanceIds.length) {
      const {data: matches}=await db.from('payment_matches').select('id,bill_id,month,status').in('transaction_id',disappearanceIds);
      const {error}=await db.from('bank_transactions').delete().eq('bank_item_id',item.id).in('id',disappearanceIds);
      if(error) throw error;
      for(const match of matches||[]) {
        const {data:paid}=await db.from('bill_payments').select('source,match_id').eq('bill_id',match.bill_id).eq('month',match.month).maybeSingle();
        if(paid?.match_id!==match.id) continue;
        if(match.status==='suggested' && paid.source==='bank_suggestion') {
          await db.from('bill_payments').update({status:'unpaid',source:'manual',match_id:null,updated_at:new Date().toISOString()}).eq('bill_id',match.bill_id).eq('month',match.month);
        }
        if(match.status==='confirmed' && paid?.source==='bank_match') {
          await db.from('bill_payments').update({status:'review',source:'bank_suggestion',match_id:null,updated_at:new Date().toISOString()}).eq('bill_id',match.bill_id).eq('month',match.month);
          await notifyHousehold(item.household_id,'Payment needs review','A previously matched bank transaction was removed or changed. Please check the bill.',`reversed:${match.bill_id}:${match.month}`);
        }
      }
    }
  }
  const {data:bills,error:billError}=await db.from('bills').select('*').eq('household_id',item.household_id);
  if(billError) throw billError;
  let matchesCreated=0;
  for(const tx of [...added,...modified]) {
    const {data:record}=await db.from('bank_transactions').select('id').eq('plaid_transaction_id',tx.transaction_id).single();
    if(!record) continue;
    const merchant_name=tx.merchant_name||tx.name;
    const month=tx.date.slice(0,7);
    const possible=(bills||[]).map(b=>({bill:b, match:matchTransaction({merchant_name,amount:tx.amount,pending:tx.pending,posted_on:tx.date},b,month)}))
      .filter(x=>x.match!==null).sort((a,b)=>Number(b.match?.status==='confirmed')-Number(a.match?.status==='confirmed') || (b.match?.score||0)-(a.match?.score||0));
    for(const {bill,match} of possible) {
      if(!match) continue;
      const {data:current}=await db.from('bill_payments').select('status,source').eq('bill_id',bill.id).eq('month',month).maybeSingle();
      if(current?.status==='paid') break;
      if(current?.status==='review' && current.source==='manual') break;
      const {data:existingForTransaction}=await db.from('payment_matches').select('id,bill_id').eq('transaction_id',record.id).in('status',['suggested','confirmed']).maybeSingle();
      if(existingForTransaction && existingForTransaction.bill_id!==bill.id) break;
      const {data:previouslyDismissed}=await db.from('payment_matches').select('status').eq('bill_id',bill.id).eq('month',month).eq('transaction_id',record.id).maybeSingle();
      if(previouslyDismissed?.status==='dismissed') break;
      const {data:matchRow,error:matchError}=await db.from('payment_matches').upsert({
        bill_id:bill.id,month,transaction_id:record.id,
        confidence:match.score,status:match.status
      },{onConflict:'bill_id,month,transaction_id'}).select('id').single();
      if(matchError || !matchRow) continue;
      const {error:paymentError}=await db.from('bill_payments').upsert({
        bill_id:bill.id,month,
        status:match.status==='confirmed'?'paid':'review',
        source:match.status==='confirmed'?'bank_match':'bank_suggestion',
        match_id:matchRow.id,updated_by:null,updated_at:new Date().toISOString()
      },{onConflict:'bill_id,month'});
      if(paymentError) throw paymentError;
      matchesCreated++;
      await notifyHousehold(item.household_id,
        match.status==='confirmed'?'Payment detected ✓':'Possible payment found',
        `${bill.name}: $${Number(tx.amount).toFixed(2)} ${match.status==='confirmed'?'posted and matched.':'needs confirmation.'}`,
        `match:${matchRow.id}:${match.status}`);
      break;
    }
  }
  const {error:updateError}=await db.from('bank_items').update({cursor,last_sync_at:new Date().toISOString()}).eq('id',itemId);
  if(updateError) throw updateError;
  return {new_transactions:added.length, updated_transactions:modified.length, removed_transactions:removed.length, matches:matchesCreated};
}
