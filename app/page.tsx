'use client';

import { useEffect,useMemo,useState,useCallback } from 'react';
import Script from 'next/script';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { browserDb } from '@/lib/supabase';
import {
  Home,Wallet,Users,Bell,Settings,Plus,Check,ArrowRight,Landmark,RefreshCw,
  ShieldCheck,AlertCircle,CalendarDays,Link2,Copy,Trash2,LogOut,CheckCircle2,
  X,PenLine,LoaderCircle,Smartphone,ChevronLeft,ChevronRight,Download,Send
} from 'lucide-react';

type Bill={id:string;household_id:string;name:string;amount:number|null;due_day:number|null;category:string;payer:'Shared'|'Alex'|'Sam';confirmed:boolean;merchant_keywords:string[]};
type Payment={bill_id:string;month:string;status:'unpaid'|'paid'|'review';source:string;match_id:string|null};
type Notice={id:string;title:string;body:string;read:boolean;created_at:string};
type Household={id:string;name:string;created_by:string;invite_code:string;monthly_budget:number;alex_share:number};
type BankItem={id:string;institution_name:string;last_sync_at:string|null};
type LinkHandler={open:()=>void;destroy:()=>void};
declare global { interface Window { Plaid?: { create:(args:Record<string,unknown>)=>LinkHandler } } }
const dollars=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const currentMonth=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).formatToParts(new Date());const y=parts.find(x=>x.type==='year')?.value;const m=parts.find(x=>x.type==='month')?.value;const current=`${y}-${m}`;return current<'2026-11'?'2026-11':current;};
const monthTitle=(month:string)=>new Date(`${month}-05T12:00:00`).toLocaleDateString('en-US',{month:'long',year:'numeric'});
const shiftMonth=(month:string,delta:number)=>{const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()+delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);
function IconButton({children,onClick,title}:{children:React.ReactNode;onClick:()=>void;title:string}) {
  return <button className="icon-btn" title={title} aria-label={title} onClick={onClick}>{children}</button>;
}

export default function HomePage(){
  const db=useMemo(()=>browserDb(),[]);
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [email,setEmail]=useState('');
  const [emailSent,setEmailSent]=useState(false);
  const [nickname,setNickname]=useState('');
  const [code,setCode]=useState('');
  const [household,setHousehold]=useState<Household|null>(null);
  const [members,setMembers]=useState<{nickname:string;user_id:string}[]>([]);
  const [bills,setBills]=useState<Bill[]>([]);
  const [payments,setPayments]=useState<Payment[]>([]);
  const [notices,setNotices]=useState<Notice[]>([]);
  const [bankItems,setBankItems]=useState<BankItem[]>([]);
  const [tab,setTab]=useState<'home'|'bills'|'activity'|'settings'>('home');
  const [month,setMonth]=useState(currentMonth);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [editor,setEditor]=useState<string|null>(null);
  const [form,setForm]=useState({name:'',amount:'',due_day:'',category:'Other',payer:'Shared',keywords:'',confirmed:false});
  const [plaidReady,setPlaidReady]=useState(false);
  const [pushReady,setPushReady]=useState(false);
  const [installed,setInstalled]=useState(false);

  const reload=useCallback(async(userId:string)=>{
    const {data:membership,error:memberError}=await db.from('memberships').select('household_id').eq('user_id',userId).maybeSingle();
    if(memberError) throw memberError;
    if(!membership){setHousehold(null);setBills([]);setPayments([]);setNotices([]);return;}
    const hid=membership.household_id;
    const [h,bs,ps,ns,ms]=await Promise.all([
      db.from('households').select('*').eq('id',hid).single(),
      db.from('bills').select('*').eq('household_id',hid).order('due_day',{ascending:true,nullsFirst:false}),
      db.from('bill_payments').select('*'),
      db.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(40),
      db.from('memberships').select('nickname,user_id').eq('household_id',hid)
    ]);
    if(h.error||bs.error||ps.error||ns.error||ms.error) throw h.error||bs.error||ps.error||ns.error||ms.error;
    setHousehold(h.data as Household);setBills(bs.data||[]);setPayments(ps.data||[]);setNotices(ns.data||[]);setMembers(ms.data||[]);
  },[db]);

  const refreshBankStatus=useCallback(async(token:string)=>{
    try{const r=await fetch('/api/plaid/status',{headers:{Authorization:`Bearer ${token}`}});if(r.ok){const x=await r.json();setBankItems(x.items||[]);}}catch{}
  },[]);
  useEffect(()=>{
    let active=true;
    db.auth.getSession().then(async({data})=>{
      if(!active)return;
      setSession(data.session);
      if(data.session){try{await reload(data.session.user.id);await refreshBankStatus(data.session.access_token);}catch(e){setMessage(errorMessage(e));}}
      setLoading(false);
    });
    const {data:{subscription}}=db.auth.onAuthStateChange((_event:AuthChangeEvent,next:Session|null)=>{
      if(!active)return;
      setSession(next);
      if(next){void reload(next.user.id).catch(e=>setMessage(errorMessage(e)));void refreshBankStatus(next.access_token);}
      else{setHousehold(null);setBills([]);setPayments([]);setNotices([]);setBankItems([]);}
    });
    return()=>{active=false;subscription.unsubscribe();};
  },[db,reload,refreshBankStatus]);
  useEffect(()=>{
    if(!household||!session)return;
    const id=session.user.id;
    const refresh=()=>void reload(id).catch(e=>setMessage(errorMessage(e)));
    const channel=db.channel(`homebase:${household.id}:${id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'bills',filter:`household_id=eq.${household.id}`},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'bill_payments'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${id}`},refresh)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'households',filter:`id=eq.${household.id}`},refresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'memberships',filter:`household_id=eq.${household.id}`},refresh)
      .subscribe();
    return()=>{void db.removeChannel(channel);};
  },[db,household?.id,session?.user.id,reload]);
  useEffect(()=>{
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);
    setPushReady('serviceWorker' in navigator && 'PushManager' in window);
    if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
  },[]);

  const payMap=useMemo(()=>new Map(payments.filter(x=>x.month===month).map(x=>[x.bill_id,x])),[payments,month]);
  const total=bills.reduce((s,b)=>s+Number(b.amount||0),0);
  const paid=bills.filter(b=>payMap.get(b.id)?.status==='paid').reduce((s,b)=>s+Number(b.amount||0),0);
  const review=bills.filter(b=>payMap.get(b.id)?.status==='review').length;
  const budget=Number(household?.monthly_budget||3000);
  const josh=bills.reduce((s,b)=>s+Number(b.amount||0)*(b.payer==='Alex'?1:b.payer==='Sam'?0:(household?.alex_share??50)/100),0);
  const isOwner=household?.created_by===session?.user.id;
  const authorized=async()=>{
    const {data}=await db.auth.getSession();
    if(!data.session)throw new Error('Please sign in again');
    return data.session.access_token;
  };
  const request=async(path:string,body?:unknown)=>{
    const token=await authorized();
    const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const result=await res.json();
    if(!res.ok)throw new Error(result.error||'Request failed');
    return result;
  };
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(errorMessage(e));}finally{setBusy(false);}};
  const paymentAction=(bill:Bill,paid:boolean)=>run(async()=>{
    const {error}=await db.from('bill_payments').upsert({bill_id:bill.id,month,status:paid?'paid':'unpaid',source:'manual',match_id:null,updated_by:session?.user.id,updated_at:new Date().toISOString()},{onConflict:'bill_id,month'});
    if(error)throw error;
    if(session)await reload(session.user.id);
  });
  const decision=(bill:Bill,choice:'approve'|'dismiss')=>run(async()=>{
    await request('/api/matches/review',{bill_id:bill.id,month,decision:choice});
    if(session)await reload(session.user.id);
  });
  const edit=(bill?:Bill)=>{
    if(bill){setEditor(bill.id);setForm({name:bill.name,amount:bill.amount===null?'':String(bill.amount),due_day:bill.due_day===null?'':String(bill.due_day),category:bill.category,payer:bill.payer,keywords:bill.merchant_keywords.join(', '),confirmed:bill.confirmed});}
    else{setEditor('new');setForm({name:'',amount:'',due_day:'',category:'Other',payer:'Shared',keywords:'',confirmed:false});}
    setTab('bills');
  };
  const saveBill=()=>run(async()=>{
    if(!household)throw new Error('No household');
    if(!form.name.trim())throw new Error('Bill name required');
    const due=form.due_day.trim()===''?null:Number(form.due_day);
    const amt=form.amount.trim()===''?null:Number(form.amount);
    if(due!==null&&(!Number.isInteger(due)||due<1||due>31))throw new Error('Due day must be between 1 and 31');
    if(amt!==null&&(!Number.isFinite(amt)||amt<0))throw new Error('Amount must be zero or greater');
    const row={name:form.name.trim(),amount:amt,due_day:due,category:form.category,payer:form.payer,confirmed:form.confirmed,merchant_keywords:form.keywords.split(',').map(x=>x.trim()).filter(x=>x.length>=4)};
    const {error}=editor==='new'?await db.from('bills').insert({...row,household_id:household.id}):await db.from('bills').update(row).eq('id',editor);
    if(error)throw error;
    setEditor(null);if(session)await reload(session.user.id);
  });
  const deleteBill=(bill:Bill)=>run(async()=>{
    if(!window.confirm(`Delete ${bill.name} and its monthly payment history?`))return;
    const {error}=await db.from('bills').delete().eq('id',bill.id);
    if(error)throw error;
    setEditor(null);if(session)await reload(session.user.id);
  });
  const sendMagic=()=>run(async()=>{
    const {error}=await db.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});
    if(error)throw error;setEmailSent(true);
  });
  const createHouse=()=>run(async()=>{
    const {error}=await db.rpc('create_household',{household_name:'Alex & Sam’s Home',person_name:nickname});
    if(error)throw error;if(session)await reload(session.user.id);
  });
  const joinHouse=()=>run(async()=>{
    const {error}=await db.rpc('join_household',{code:code.trim(),person_name:nickname});
    if(error)throw error;if(session)await reload(session.user.id);
  });
  const linkBank=()=>run(async()=>{
    if(!window.Plaid)throw new Error('Bank connection is still loading');
    const {link_token}=await request('/api/plaid/link-token',{});
    sessionStorage.setItem('homebase_plaid_link_token',link_token);
    const handler=window.Plaid.create({
      token:link_token,
      onSuccess:async(public_token:string)=>{
        try { const result=await request('/api/plaid/exchange',{public_token});
          sessionStorage.removeItem('homebase_plaid_link_token');
          setMessage(result.initialSync==='complete'?'Bank connected and synced.':'Bank connected. Waiting for transaction history.');
          if(session){await refreshBankStatus(session.access_token);await reload(session.user.id);}
        }catch(e){setMessage(errorMessage(e));}
      },onExit:()=>handler.destroy()
    });handler.open();
  });
  useEffect(()=>{
    if(!plaidReady||!session||!window.Plaid)return;
    const oauth=new URLSearchParams(window.location.search).has('oauth_state_id');
    const token=sessionStorage.getItem('homebase_plaid_link_token');
    if(!oauth||!token)return;
    const handler=window.Plaid.create({token,receivedRedirectUri:window.location.href,
      onSuccess:async(public_token:string)=>{
        try {await request('/api/plaid/exchange',{public_token});sessionStorage.removeItem('homebase_plaid_link_token');
          history.replaceState({},'', '/');await refreshBankStatus(session.access_token);await reload(session.user.id);
          setMessage('Bank account connected successfully.');}catch(e){setMessage(errorMessage(e));}
      }
    });handler.open();
    // Only once when returning from an institution redirect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[plaidReady,session?.user.id]);
  const disconnectBank=(item:BankItem)=>run(async()=>{
    if(!window.confirm('Disconnect this bank? Plaid access will be revoked and its synced transactions removed.'))return;
    await request('/api/plaid/disconnect',{id:item.id});
    if(session){await refreshBankStatus(session.access_token);await reload(session.user.id);}
    setMessage('Bank disconnected and access revoked.');
  });
  const syncBanks=()=>run(async()=>{
    const result=await request('/api/plaid/sync',{});
    if(session)await reload(session.user.id);
    const updates=(result.results||[]).reduce((s:number,r:{new_transactions?:number})=>s+(r.new_transactions||0),0);
    setMessage(`${result.accounts} linked account(s) checked · ${updates} new transactions. Bank data may take hours to update.`);
  });
  const enablePush=()=>run(async()=>{
    if(!pushReady)throw new Error('This browser does not support web push notifications');
    if(!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)throw new Error('Configure VAPID keys first');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Notifications were not allowed');
    const registration=await navigator.serviceWorker.ready;
    const publicKey=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const base64=publicKey.replace(/-/g,'+').replace(/_/g,'/');
    const padded=base64.padEnd(Math.ceil(base64.length/4)*4,'=');
    const bytes=Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
    const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    await request('/api/push/subscribe',sub.toJSON());
    setMessage('Push notifications enabled on this device.');
  });
  const saveSettings=(target:'budget'|'split',value:number)=>run(async()=>{
    if(!household||!isOwner)throw new Error('Only the household creator can change these settings');
    const {error}=await db.from('households').update(target==='budget'?{monthly_budget:value}:{alex_share:value}).eq('id',household.id);
    if(error)throw error;if(session)await reload(session.user.id);
  });
  const rotateInvite=()=>run(async()=>{
    if(!household||!isOwner)throw new Error('Only the household creator can rotate invites');
    const {error}=await db.rpc('rotate_invite',{hid:household.id});
    if(error)throw error;
    if(session)await reload(session.user.id);
    setMessage('Invitation code rotated. Any older code will no longer work.');
  });
  const readNotices=()=>run(async()=>{
    const {error}=await db.from('notifications').update({read:true}).eq('user_id',session?.user.id).eq('read',false);
    if(error)throw error;if(session)await reload(session.user.id);
  });

  if(loading)return <div className="loading-center"><LoaderCircle className="spin"/> Loading HomeBase…</div>;
  if(!session)return <main className="auth-page">
    <div className="auth-card">
      <div className="logo-square"><Home size={28}/></div><h1>homebase<span>.</span></h1>
      <p className="subtitle">One home. Two people. No surprise bills.</p>
      <div className="illustration"><div className="ill-chart"/><div className="ill-dot a"/><div className="ill-dot b"/><Home size={86}/></div>
      <h2>Household money, together.</h2>
      <p className="muted">See upcoming bills, share payments instantly, and connect your bank to spot payments automatically.</p>
      {emailSent?<div className="success-panel"><CheckCircle2/> Check your inbox for your sign-in link.</div>:
        <form onSubmit={e=>{e.preventDefault();void sendMagic();}}><label>Email address</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" required/><button className="primary full" disabled={busy}>Send secure sign-in link <ArrowRight size={18}/></button></form>}
      {message&&<p className="error-text">{message}</p>}
      <p className="footnote"><ShieldCheck size={14}/> Passwordless login · bank credentials never stored in your browser</p>
    </div>
  </main>;
  if(!household)return <main className="auth-page"><div className="auth-card"><div className="logo-square"><Home/></div><h1>Make it ours.</h1><p className="muted">Create your shared HomeBase, or enter the invitation code from your partner.</p><label>Your name</label><input value={nickname} placeholder="Alex or Sam" onChange={e=>setNickname(e.target.value)}/><button className="primary full" onClick={()=>void createHouse()} disabled={busy||!nickname.trim()}>Create our household <ArrowRight size={18}/></button><div className="or-line">or join an existing one</div><label>Household invite code</label><input placeholder="Paste 24-character invite code" value={code} onChange={e=>setCode(e.target.value)}/><button className="secondary full" onClick={()=>void joinHouse()} disabled={busy||!code.trim()||!nickname.trim()}>Join partner's household</button>{message&&<p className="error-text">{message}</p>}<button className="text-btn" onClick={()=>void db.auth.signOut()}>Sign out</button></div></main>;

  const billSorted=[...bills].sort((a,b)=>(a.due_day??99)-(b.due_day??99));
  const unread=notices.filter(n=>!n.read).length;
  const categories=Object.entries(bills.reduce<Record<string,number>>((acc,b)=>{acc[b.category]=(acc[b.category]||0)+Number(b.amount||0);return acc;},{})).sort((a,b)=>b[1]-a[1]);
  return <div className="shell">
    <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="afterInteractive" onReady={()=>setPlaidReady(true)}/>
    <aside className="sidebar">
      <div className="brand"><div className="logo-square"><Home/></div><div><strong>homebase<span>.</span></strong><small>Our shared home</small></div></div>
      <nav>
        <button className={tab==='home'?'active':''} onClick={()=>setTab('home')}><Home size={19}/> Overview</button>
        <button className={tab==='bills'?'active':''} onClick={()=>setTab('bills')}><Wallet size={19}/> Bills <span className="side-count">{bills.length}</span></button>
        <button className={tab==='activity'?'active':''} onClick={()=>setTab('activity')}><Bell size={19}/> Activity {unread>0&&<span className="side-count hot">{unread}</span>}</button>
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings size={19}/> Settings</button>
      </nav>
      <div className="sidebar-bottom"><div className="avatar-pair"><span>J</span><span>A</span></div><p>Better together.<small>{members.length} member{members.length!==1?'s':''} connected</small></p></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">JOSHUA & AILEEN · HOME FINANCES</span><h1>{tab==='home'?'Good to be home.':tab==='bills'?'All your bills.':tab==='activity'?'Household updates.':'Your home, your rules.'}</h1></div><div className="top-actions"><span className="live-dot"/> <span className="live-text">Shared live</span><IconButton title="Notifications" onClick={()=>setTab('activity')}><Bell size={19}/>{unread>0&&<i className="alert-dot"/>}</IconButton></div></header>
      {message&&<div className="toast"><AlertCircle size={17}/><span>{message}</span><button onClick={()=>setMessage('')}><X size={16}/></button></div>}
      {tab==='home'&&<>
        <div className="hero"><div className="hero-row"><div><span className="eyebrow light">YOUR HOUSEHOLD · {monthTitle(month).toUpperCase()}</span><div className="big-money">{dollars(total)}</div><div className="hero-sub">Expected monthly bills <span className="round-separator">·</span> {dollars(total-paid)} remaining</div></div><div className="month-nav"><button onClick={()=>setMonth(x=>shiftMonth(x,-1))}><ChevronLeft size={18}/></button><span>{monthTitle(month)}</span><button onClick={()=>setMonth(x=>shiftMonth(x,1))}><ChevronRight size={18}/></button></div></div><div className="progress-track"><div style={{width:`${total?paid/total*100:0}%`}}/></div><div className="hero-foot"><span>{bills.filter(b=>payMap.get(b.id)?.status==='paid').length} / {bills.length} paid</span><span>{total?Math.round(paid/total*100):0}% complete</span></div></div>
        <div className="metrics"><section className="metric"><div className="metric-heading"><Wallet size={18}/> Alex's share</div><strong>{dollars(josh)}</strong><small>Estimated monthly portion</small></section><section className="metric"><div className="metric-heading"><Users size={18}/> Sam's share</div><strong>{dollars(total-josh)}</strong><small>Estimated monthly portion</small></section><section className="metric"><div className="metric-heading"><ShieldCheck size={18}/> Budget remaining</div><strong className={budget<total?'danger':''}>{dollars(budget-total)}</strong><small>Based on {dollars(budget)} target</small></section></div>
        {review>0&&<div className="review-callout"><AlertCircle size={22}/><div><strong>{review} possible bank payment{review>1?'s':''} need review</strong><p>We found a likely charge, but need you to confirm it was for the bill.</p></div><button onClick={()=>setTab('bills')}>Review <ArrowRight size={15}/></button></div>}
        <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h2>Upcoming bills</h2><p>Everything expected this month</p></div><button className="link-button" onClick={()=>setTab('bills')}>View all <ArrowRight size={16}/></button></div><div className="bill-list">{billSorted.map(b=><BillRow key={b.id} bill={b} payment={payMap.get(b.id)} month={month} onPaid={()=>void paymentAction(b,true)} onUnpaid={()=>void paymentAction(b,false)} onReview={()=>setTab('bills')} busy={busy}/>)}</div><button className="ghost-add" onClick={()=>edit()}><Plus size={18}/> Add another bill</button></section>
        <section className="stacked"><div className="panel"><div className="panel-heading"><div><h2>Spending breakdown</h2><p>By category</p></div></div><div className="bar-list">{categories.map(([name,amount],i)=><div key={name}><div className="bar-label"><span>{name}</span><strong>{dollars(amount)}</strong></div><div className="bar-track"><div style={{width:`${total?amount/total*100:0}%`,background:['#69b9a0','#b5a2df','#ecb879','#a6bdcf','#d0a1aa'][i%5]}}/></div></div>)}</div></div><div className="panel bank-panel"><div className="panel-heading"><div><h2>Connected banking</h2><p>{bankItems.length?`${bankItems.length} personal connection(s)`:'Automatic bill detection'}</p></div><Landmark size={24}/></div><p className="muted">{bankItems.length?'Bank activity is checked for bill payments.':'Link a bank to recognize bills as payments post.'}</p><button className="secondary full" disabled={busy||!plaidReady} onClick={()=>void linkBank()}><Link2 size={16}/> {bankItems.length?'Add another bank':'Connect your bank'} <ArrowRight size={16}/></button>{bankItems.length>0&&<button className="text-btn" disabled={busy} onClick={()=>void syncBanks()}><RefreshCw size={14}/> Check for new charges</button>}</div></section></div>
      </>}
      {tab==='bills'&&<div className="wide-panel panel"><div className="panel-heading"><div><h2>Manage recurring bills</h2><p>{monthTitle(month)} · live across both accounts</p></div><button className="primary small" onClick={()=>edit()}><Plus size={17}/> New bill</button></div><div className="month-strip"><button onClick={()=>setMonth(x=>shiftMonth(x,-1))}><ChevronLeft size={18}/></button>{monthTitle(month)}<button onClick={()=>setMonth(x=>shiftMonth(x,1))}><ChevronRight size={18}/></button></div><div className="bill-cards">{billSorted.map(b=>{const p=payMap.get(b.id);return <div className="bill-card" key={b.id}><div className="bill-card-top"><div className="bill-icon"><Wallet size={20}/></div><div className="bill-description"><strong>{b.name}</strong><small>{b.category} · {b.payer} · due {b.due_day||'TBD'}</small></div><strong className="amount">{b.amount==null?'TBD':dollars(b.amount)}</strong></div><div className="bill-card-actions"><span className={`pill ${p?.status||'unpaid'}`}>{p?.status==='paid'?'✓ Paid':p?.status==='review'?'! Needs review':'Not paid'}</span><span className="bill-confidence">{b.confirmed?'Amount confirmed':'Estimate / not confirmed'}</span><div className="flex-fill"/><IconButton title="Edit bill" onClick={()=>edit(b)}><PenLine size={16}/></IconButton>{p?.status==='review'?<><button className="mini accept" disabled={busy} onClick={()=>void decision(b,'approve')}><Check size={14}/> Yes, paid</button><button className="mini" disabled={busy} onClick={()=>void decision(b,'dismiss')}>Not this bill</button></>:p?.status==='paid'?<button className="mini" disabled={busy} onClick={()=>void paymentAction(b,false)}>Undo paid</button>:<button className="mini accept" disabled={busy} onClick={()=>void paymentAction(b,true)}><Check size={14}/> Mark paid</button>}</div></div>;})}</div>
      {editor&&<div className="editor-wrap"><div className="panel-heading"><h2>{editor==='new'?'Add a recurring bill':'Edit bill'}</h2><IconButton title="Close editor" onClick={()=>setEditor(null)}><X size={18}/></IconButton></div><div className="form-grid"><div className="span-all"><label>Bill name</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Car insurance"/></div><div><label>Expected amount ($)</label><input type="number" min="0" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="Unknown"/></div><div><label>Day of month due</label><input type="number" min="1" max="31" value={form.due_day} onChange={e=>setForm(f=>({...f,due_day:e.target.value}))} placeholder="Unconfirmed"/></div><div><label>Category</label><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{['Housing','Utilities','Internet','Insurance','Groceries','Transportation','Subscriptions','Other'].map(x=><option key={x}>{x}</option>)}</select></div><div><label>Responsibility</label><select value={form.payer} onChange={e=>setForm(f=>({...f,payer:e.target.value}))}>{['Shared','Alex','Sam'].map(x=><option key={x}>{x}</option>)}</select></div><div className="span-all"><label>Bank merchant keywords (comma-separated)</label><input value={form.keywords} onChange={e=>setForm(f=>({...f,keywords:e.target.value}))} placeholder="e.g. Comcast, Xfinity"/><small className="muted">Only use names you recognize. A merchant match plus the exact posted amount can auto-confirm verified bills.</small></div><label className="check-label span-all"><input type="checkbox" checked={form.confirmed} onChange={e=>setForm(f=>({...f,confirmed:e.target.checked}))}/> The amount has been verified</label></div><div className="editor-actions"><button className="primary" disabled={busy||!form.name.trim()} onClick={()=>void saveBill()}><Check size={16}/> Save bill</button>{editor!=='new'&&<button className="danger-button" disabled={busy} onClick={()=>{const b=bills.find(x=>x.id===editor);if(b)void deleteBill(b);}}><Trash2 size={16}/> Delete</button>}</div></div>}
      </div>}
      {tab==='activity'&&<div className="wide-panel panel"><div className="panel-heading"><div><h2>Notifications</h2><p>Due dates, updates and bank-detected charges</p></div>{unread>0&&<button className="secondary small" onClick={()=>void readNotices()}>Mark all read</button>}</div><div className="activity-list">{notices.length===0?<div className="empty-state"><Bell size={33}/><h3>All quiet at home.</h3><p>Payment activity and reminders will appear here.</p></div>:notices.map(n=><div className={`activity-item ${n.read?'':'unread'}`} key={n.id}><div className="activity-mark"><Bell size={17}/></div><div><strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small></div></div>)}</div><div className="notification-action"><div><h3>Get notified on your phone</h3><p>Push alerts for bills due soon and detected payments.</p></div><button className="primary small" onClick={()=>void enablePush()} disabled={busy||!pushReady}><Smartphone size={16}/> Enable notifications</button></div></div>}
      {tab==='settings'&&<div className="wide-panel panel settings-panel"><h2>Household settings</h2><div className="setting-row"><div><h3>Our members</h3><p>Each person signs in with their own email address.</p></div><div className="member-list">{members.map(m=><span key={m.user_id} className="member-chip"><Users size={14}/>{m.nickname}</span>)}</div></div><div className="setting-row"><div><h3>Monthly budget</h3><p>Your target for tracked recurring bills.</p></div><input className="setting-number" type="number" min="0" defaultValue={budget} key={`budget:${budget}`} disabled={!isOwner} onBlur={e=>{const v=Number(e.target.value);if(v>=0&&v!==budget)void saveSettings('budget',v);}}/></div><div className="setting-row"><div><h3>Shared bill split</h3><p>Alex {household.alex_share}% · Sam {100-household.alex_share}%</p></div><input type="range" min="0" max="100" step="5" value={household.alex_share} disabled={!isOwner} onChange={e=>setHousehold(h=>h?{...h,alex_share:Number(e.target.value)}:h)} onPointerUp={e=>void saveSettings('split',Number((e.target as HTMLInputElement).value))} onKeyUp={e=>void saveSettings('split',Number((e.target as HTMLInputElement).value))}/></div><div className="setting-row"><div><h3>Invite Sam</h3><p>Share this code privately. It lets someone join and see all household bills.</p></div><div className="setting-buttons"><button className="secondary" onClick={()=>{void navigator.clipboard.writeText(household.invite_code);setMessage('Invitation code copied. Share it privately with Sam.');}}><Copy size={16}/> Copy invite code</button>{isOwner&&<button className="secondary" disabled={busy} onClick={()=>void rotateInvite()}><RefreshCw size={16}/> Rotate</button>}</div></div><div className="setting-row"><div><h3>Bank data</h3><p>Connected bank transactions stay server-side. Only matched bill status is shared.</p><small className="muted">{bankItems.length} bank connection(s) attached to your login.</small>
   {bankItems.map(item=><div className="bank-connected" key={item.id}><span><Landmark size={14}/>{item.institution_name} · {item.last_sync_at?`Synced ${new Date(item.last_sync_at).toLocaleDateString()}`:'Awaiting first sync'}</span><button disabled={busy} onClick={()=>void disconnectBank(item)}>Disconnect</button></div>)}</div><div className="setting-buttons"><button className="secondary" disabled={busy||!plaidReady} onClick={()=>void linkBank()}><Landmark size={16}/> Connect</button><button className="secondary" disabled={busy} onClick={()=>void syncBanks()}><RefreshCw size={16}/> Sync</button></div></div><div className="setting-row"><div><h3>Phone alerts</h3><p>On iPhone, first add HomeBase to your home screen.</p></div><button className="secondary" disabled={busy||!pushReady} onClick={()=>void enablePush()}><Bell size={16}/> Enable push</button></div><div className="setting-row"><div><h3>App installation</h3><p>{installed?'Running as an installed app.':'Open your browser menu and choose Add to Home Screen / Install app.'}</p></div><span className="member-chip"><Download size={15}/>{installed?'Installed':'Installable PWA'}</span></div><div className="setting-row"><div><h3>Security</h3><p>Magic-link sign-in, protected household database, and encrypted Plaid access tokens.</p></div><button className="secondary" onClick={()=>void db.auth.signOut()}><LogOut size={16}/> Sign out</button></div></div>}
      <footer className="page-footer"><ShieldCheck size={15}/> Bank transactions are read-only. HomeBase does not move money or pay bills on your behalf. · Built for two.</footer>
    </main>
    <nav className="mobile-nav"><button className={tab==='home'?'active':''} onClick={()=>setTab('home')}><Home size={20}/>Home</button><button className={tab==='bills'?'active':''} onClick={()=>setTab('bills')}><Wallet size={20}/>Bills</button><button className={tab==='activity'?'active':''} onClick={()=>setTab('activity')}><Bell size={20}/>Updates</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings size={20}/>Settings</button></nav>
  </div>;
}

function BillRow({bill,payment,month,onPaid,onUnpaid,onReview,busy}:{bill:Bill;payment?:Payment;month:string;onPaid:()=>void;onUnpaid:()=>void;onReview:()=>void;busy:boolean}){
  const status=payment?.status||'unpaid';
  return <div className="bill-row"><div className="due-box"><span>{new Date(`${month}-05T12:00:00`).toLocaleDateString('en-US',{month:'short'})}</span><strong>{bill.due_day||'—'}</strong></div><div className="bill-details"><strong>{bill.name}</strong><small>{bill.payer} · {bill.amount===null?'Amount unknown':bill.confirmed?'Amount confirmed':'Est. amount'}</small></div><div className="bill-right"><strong>{bill.amount===null?'TBD':dollars(Number(bill.amount))}</strong>{status==='paid'?<button className="status paid" disabled={busy} onClick={onUnpaid}><Check size={12}/> Paid</button>:status==='review'?<button className="status review" onClick={onReview}><AlertCircle size={12}/> Review</button>:<button className="status pending" disabled={busy} onClick={onPaid}>Mark paid</button>}</div></div>;
}
