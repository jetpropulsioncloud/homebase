import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest,memberHousehold } from '@/lib/security';
import { plaidPost } from '@/lib/plaid';
export const runtime='nodejs';
export async function POST(req:NextRequest) {
  const user=await userFromRequest(req);
  if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
  if(!(await memberHousehold(user.id))) return NextResponse.json({error:'Join a household first'},{status:403});
  try {
    const url=process.env.NEXT_PUBLIC_APP_URL||'';
    const body:Record<string,unknown>={
      client_name:'HomeBase', language:'en', country_codes:['US'], products:['transactions'],
      user:{client_user_id:user.id}, transactions:{days_requested:90}
    };
    if(url.startsWith('https://')) body.webhook=url.replace(/\/$/,'')+'/api/plaid/webhook';
    if(process.env.PLAID_REDIRECT_URI) body.redirect_uri=process.env.PLAID_REDIRECT_URI;
    const data=await plaidPost<{link_token:string}>('/link/token/create',body);
    return NextResponse.json({link_token:data.link_token});
  } catch(e) { return NextResponse.json({error:String(e)},{status:502}); }
}
