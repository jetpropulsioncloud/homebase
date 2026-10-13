import { NextRequest, NextResponse } from 'next/server';
import { serviceDb } from '@/lib/supabase';
import { notifyHousehold } from '@/lib/notifications';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:NextRequest) {
  if(!process.env.CRON_SECRET || req.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error:'Unauthorized'},{status:401});
  const db=serviceDb();
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const field=(type:string)=>parts.find(p=>p.type===type)?.value||'01';
  const year=Number(field('year')), monthNum=Number(field('month')),day=Number(field('day'));
  const month=`${year}-${String(monthNum).padStart(2,'0')}`;
  const today=Date.UTC(year,monthNum-1,day);
  const lastDay=new Date(Date.UTC(year,monthNum,0)).getUTCDate();
  const {data:bills,error}=await db.from('bills').select('id,name,due_day,household_id');
  if(error) return NextResponse.json({error:'Database unavailable'},{status:503});
  let delivered=0;
  for(const b of bills||[]) {
    if(!b.due_day) continue;
    const dueDay=Math.min(b.due_day,lastDay);
    const daysUntil=Math.round((Date.UTC(year,monthNum-1,dueDay)-today)/86400000);
    if(![7,3,1,0,-2].includes(daysUntil)) continue;
    const {data:payment}=await db.from('bill_payments').select('status').eq('bill_id',b.id).eq('month',month).maybeSingle();
    if(payment?.status==='paid') continue;
    const title=daysUntil<0?'Overdue bill':daysUntil===0?'Bill due today':`Bill due in ${daysUntil} day${daysUntil===1?'':'s'}`;
    const suffix=payment?.status==='review'?'Possible bank payment still needs your review.':'';
    await notifyHousehold(b.household_id,title,`${b.name} · ${month}-${String(dueDay).padStart(2,'0')}. ${suffix}`.trim(),`reminder:${b.id}:${month}:${daysUntil}`);
    delivered++;
  }
  return NextResponse.json({checked:(bills||[]).length,reminders:delivered});
}
