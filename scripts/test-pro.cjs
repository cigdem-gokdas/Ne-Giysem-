const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto } = require('node:crypto');
let now = Date.now(), paid = false, failRC = false, rcCalls = 0;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const rows = new Map();
const origin = 'https://worker.example';
const uid = 'alice';
const env = { FIREBASE_PROJECT_ID: 'demo-ne-giysem', REVENUECAT_SECRET_KEY: 'test', IMAGES: { head: async () => ({ customMetadata: { accessToken: 'media-token' } }) } };
async function external(url, options) {
 if (url.startsWith('https://api.revenuecat.com')) { rcCalls++; return failRC ? new Response('', {status:503}) : Response.json({ subscriber: { entitlements: paid ? { pro: { product_identifier:'monthly', expires_date:new Date(now+3600000).toISOString() } } : {}, subscriptions: {monthly:{store:'app_store',is_sandbox:false}} } }); }
 if (url.endsWith(':runAggregationQuery')) return Response.json([{result:{aggregateFields:{total:{integerValue:String(rows.size)}}}}]);
 if (url.endsWith(':commit')) { const write=JSON.parse(options.body).writes[0], id=write.update.name.split('/').pop(); assert.equal(write.currentDocument.exists,false); assert.ok(!rows.has(id)); rows.set(id,write.update); return Response.json({}); }
 if (url.includes('/wardrobe/')) { const item=rows.get(url.split('/').pop()); return item ? Response.json(item) : new Response('',{status:404}); }
 throw Error('Unexpected network '+url);
}
const modules = new Map();
function load(name) {
 const file=path.resolve('api-worker/src', name+'.ts'); if(modules.has(file))return modules.get(file);
 const module={exports:{}}; modules.set(file,module.exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{ module,exports:module.exports,require: n=>n==='./accountDeletion'?{adminToken:async()=> 'test-admin'}:load(n), Date:Clock,fetch:external,Request,Response,URL,AbortSignal,crypto:webcrypto });return module.exports;
}
const { RateLimiter }=load('rateLimiter'), {verifiedPlan}=load('subscriptions');
const values=new Map();let queue=Promise.resolve();
const state={storage:{get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(key=>values.delete(key))},blockConcurrencyWhile:fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
let limiter=new RateLimiter(state,env);
const call=(path,input={})=>limiter.fetch(new Request('https://rate/'+path,{method:'POST',body:JSON.stringify({uid,...input})}));
let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const wardrobe=(n)=>({ key:`wardrobe/alice/12345678-1234-1234-1234-${String(n).padStart(12,'0')}.jpg`, origin, tags:{tur:'üst',renk:'siyah',secondaryColors:[],desen:'düz',kesim:'normal',altTur:'tişört',kemerUygun:false,season:['sonbahar'],styleTags:['klasik'],formality:'smart casual',materialGuess:'pamuk tahmini'} });
(async()=>{
 await check('free photo analysis blocked',async()=>assert.equal((await call('reserve',{feature:'analysis'})).status,403));
 await check('three lifetime free chats, fourth denied',async()=>{for(let i=0;i<3;i++){const r=await call('reserve',{feature:'chat'});assert.equal(r.status,200);await call('success',await r.json());now+=9000;}assert.equal((await call('reserve',{feature:'chat'})).status,403);});
 await check('trial persists across object recreation and month rollover',async()=>{limiter=new RateLimiter(state,env);now+=32*86400000;assert.equal((await call('reserve',{feature:'chat'})).status,403);assert.equal((await (await call('plan')).json()).freeChatsRemaining,0);});
 await check('Pro chat does not reset or spend free trial',async()=>{paid=true;now+=61000;const r=await call('reserve',{feature:'chat'});assert.equal(r.status,200);await call('success',await r.json());assert.equal(values.get('freeChatsUsed'),3);});
 await check('expired or cancelled entitlement restores exhausted free restrictions',async()=>{paid=false;now+=61000;assert.equal((await call('reserve',{feature:'chat'})).status,403);});
 await check('failed completion returns free trial, never daily cost quota',async()=>{values.set('freeChatsUsed',2);const r=await call('reserve',{feature:'chat'});const reservation=await r.json();const before=values.get('usage').count;await call('failure',reservation);assert.equal(values.get('freeChatsUsed'),2);assert.equal(values.get('usage').count,before);});
 await check('concurrent last free trial dispatched once',async()=>{now+=9000;const r=await Promise.all([call('reserve',{feature:'chat'}),call('reserve',{feature:'chat'})]);assert.equal(r.filter(v=>v.status===200).length,1);await call('success',await r.find(v=>v.status===200).json());});
 await check('server rejects forged Pro and fifty-first item',async()=>{for(let i=1;i<=50;i++)rows.set('old'+i,{fields:{userId:{stringValue:uid}}});const r=await call('wardrobe-create',{pro:true,wardrobe:wardrobe(51)});assert.equal(r.status,403);assert.equal(rows.size,50);});
 await check('capacity blocks before image upload at free limit',async()=>{const r=await call('wardrobe-capacity');assert.equal(r.status,200);assert.equal((await r.json()).canAdd,false);});
 await check('concurrent 50th / 51st adds cannot bypass limit',async()=>{rows.delete('old50');const results=await Promise.all([call('wardrobe-create',{wardrobe:wardrobe(50)}),call('wardrobe-create',{wardrobe:wardrobe(51)})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);assert.equal(rows.size,50);});
 await check('retry identical image does not duplicate or consume slot',async()=>{assert.equal((await call('wardrobe-create',{wardrobe:wardrobe(50)})).status,200);assert.equal(rows.size,50);});
 await check('Pro can add beyond 50',async()=>{paid=true;now+=61000;assert.equal((await call('wardrobe-create',{wardrobe:wardrobe(51)})).status,200);assert.equal(rows.size,51);});
 await check('downgrade preserves existing inventory and blocks new additions',async()=>{paid=false;now+=61000;assert.equal((await call('wardrobe-create',{wardrobe:wardrobe(52)})).status,403);assert.equal(rows.size,51);});
 await check('cross-account photo and malformed tags rejected',async()=>{assert.equal((await call('wardrobe-create',{wardrobe:{...wardrobe(52),key:wardrobe(52).key.replace('/alice/','/bob/')}})).status,400);assert.equal((await call('wardrobe-create',{wardrobe:{...wardrobe(52),tags:{...wardrobe(52).tags,renk:42}}})).status,400);});
 await check('provider outage fails closed after cache expiry',async()=>{failRC=true;now+=61000;assert.equal((await call('reserve',{feature:'analysis'})).status,503);failRC=false;});
 const subscriber={entitlements:{pro:{product_identifier:'monthly',expires_date:new Date(now+90000).toISOString()}},subscriptions:{monthly:{store:'app_store',is_sandbox:false}}};
 await check('subscription expiry, sandbox, refunds and client attributes cannot grant Pro',async()=>{
 assert.equal(verifiedPlan({subscriber},env,now).pro,true);
 for(const sub of [{...subscriber,entitlements:{pro:{...subscriber.entitlements.pro,expires_date:new Date(now-1).toISOString()}}},{...subscriber,subscriptions:{monthly:{store:'app_store',is_sandbox:true}}},{...subscriber,subscriptions:{monthly:{store:'app_store',is_sandbox:false,refunded_at:'2026-01-01'}}},{subscriber_attributes:{pro:true}}]) assert.equal(verifiedPlan({subscriber:sub},env,now).pro,false);
 });
 await check('sandbox review allowlist is bound to authenticated Firebase UID',async()=>{
 const sandbox={subscriber:{...subscriber,subscriptions:{monthly:{store:'app_store',is_sandbox:true}}}};
 assert.equal(verifiedPlan(sandbox,{REVENUECAT_SANDBOX_USER_IDS:'review-user'},now,'review-user').pro,true);
 assert.equal(verifiedPlan(sandbox,{REVENUECAT_SANDBOX_USER_IDS:'review-user'},now,'attacker').pro,false);
 });
 await check('no server billing key means free plan only',async()=>{const {fetchPlan}=load('subscriptions');const plan=await fetchPlan(uid,{});assert.equal(plan.pro,false);assert.equal(plan.billingReady,false);});
 await check('personal quota metadata is purged while deletion safeguards remain',async()=>{
   values.set('usage',{count:2}); values.set('uploads',{count:1}); values.set('freeChatsUsed',3); values.set('plan',{plan:{pro:false}}); values.set('appleRevoked',123);
   assert.equal((await call('purge-personal')).status,200);
   for(const key of ['usage','uploads','freeChatsUsed','plan']) assert.equal(values.has(key),false);
   assert.equal(values.get('appleRevoked'),123);
 });
 await check('deleted accounts cannot query billing or regain trial',async()=>{await call('deleting');assert.equal((await call('plan')).status,403);assert.equal((await call('reserve',{feature:'chat'})).status,403);});
 console.log(`${passed} Pro security cases passed.`);
})().catch(err=>{console.error(err);process.exitCode=1;});
