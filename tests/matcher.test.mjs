import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTransaction } from '../lib/matcher.mjs';
const rent={ amount:1800, confirmed:true, merchant_keywords:['demo property','example property management'], due_day:null };
const txn=(changes={})=>({merchant_name:'DEMO PROPERTY',amount:1800,pending:false,posted_on:'2026-11-03',...changes});
test('posted, exact, named rent charge can mark paid automatically',()=>{
  assert.equal(matchTransaction(txn(),rent,'2026-11')?.status,'confirmed');
});
test('pending charge needs review, even when otherwise exact',()=>{
  assert.equal(matchTransaction(txn({pending:true}),rent,'2026-11')?.status,'suggested');
});
test('amount mismatch is not auto-confirmed',()=>{
  assert.equal(matchTransaction(txn({amount:2010}),rent,'2026-11')?.status,'suggested');
});
test('different merchant cannot pay bill',()=>{
  assert.equal(matchTransaction(txn({merchant_name:'RESTAURANT'}),rent,'2026-11'),null);
});
test('different billing month cannot pay bill',()=>{
  assert.equal(matchTransaction(txn(),rent,'2026-12'),null);
});
test('unconfirmed internet price never auto marks as paid',()=>{
  assert.equal(matchTransaction(txn({merchant_name:'COMCAST',amount:60}), {...rent,amount:60,confirmed:false,merchant_keywords:['comcast']},'2026-11')?.status,'suggested');
});
test('variable utility without amount should be reviewed',()=>{
  assert.equal(matchTransaction(txn({merchant_name:'POTOMAC EDISON',amount:87.4}), {...rent,amount:null,confirmed:false,merchant_keywords:['potomac edison']},'2026-11')?.status,'suggested');
});
test('deposits and card refunds are ignored',()=>{
  assert.equal(matchTransaction(txn({amount:-1800}),rent,'2026-11'),null);
});

test('end-of-month rent payment needs review because it may cover next month',()=>{
  assert.equal(matchTransaction(txn({posted_on:'2026-10-31'}),rent,'2026-10')?.status,'suggested');
});
