const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
async function main() {
 const jose=await import('../api-worker/node_modules/jose/dist/webapi/index.js');
 const {privateKey,publicKey}=await jose.generateKeyPair('RS256');
 let now=Date.now(), calls=[], accountOverride=null, openAIStatus=200;
 class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
 const states=new Map(), modules=new Map(), store=new Map();
 const env={FIREBASE_PROJECT_ID:'demo-ne-giysem',FIREBASE_WEB_API_KEY:'test-public-key',ALLOWED_ORIGINS:'https://allowed.example',OPENAI_API_KEY:'test-not-a-real-secret',REVENUECAT_SECRET_KEY:'test-revenuecat-key',AI_ENABLED:'true',AI_MONTHLY_BUDGET_CENTS:'100',AI_DAILY_REQUEST_LIMIT:'100',AI_MONTHLY_REQUEST_LIMIT:'1000',AI_RESERVATION_CENTS:'5',FIREBASE_PROJECT_NUMBER:'123456',IMAGES:{head:async k=>{calls.push('r2-head');return store.get(k)??null;},get:async k=>{calls.push('r2-get');const o=store.get(k);return o?{...o,body:'img'}:null;},delete:async k=>{calls.push('r2-delete');store.delete(k);},put:async(k,v,o)=>{calls.push('r2-put');store.set(k,{size:v.byteLength,uploaded:new Clock(),httpEtag:'e',httpMetadata:o.httpMetadata,customMetadata:o.customMetadata,bytes:v});}}};
 function state(name){if(!states.has(name)){const data=new Map();let queue=Promise.resolve();states.set(name,{data,storage:{get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value)),delete:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(key=>data.delete(key))},blockConcurrencyWhile:fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;}});}return states.get(name);}
 async function external(url,options){
  if(String(url).startsWith('https://api.revenuecat.com/v1/subscribers/')) {
   const free=String(url).endsWith('/free');
   return Response.json({subscriber:{entitlements:free?{}:{pro:{product_identifier:'monthly',expires_date:new Date(now+86400000).toISOString()}},subscriptions:{monthly:{store:'app_store',is_sandbox:false}}}});
  }
  if(String(url).startsWith('https://identitytoolkit.googleapis.com')){
   calls.push('auth-lookup');const token=JSON.parse(options.body).idToken,p=jose.decodeJwt(token);
   return Response.json({users:[accountOverride??{localId:p.sub,emailVerified:true,validSince:'0'}]});
  }
  if(url==='https://api.openai.com/v1/responses'){
   calls.push('openai');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.service_tier,'default');assert.ok(body.max_output_tokens<=500);assert.equal(body.model,env.OPENAI_MODEL||'gpt-6-luna');
   return openAIStatus===200?Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({tur:'üst',renk:'siyah',secondaryColors:[],desen:'düz',kesim:'normal',altTur:'tişört',kemerUygun:false,season:['sonbahar'],styleTags:['dark academia'],formality:'smart casual',materialGuess:'pamuk tahmini'})}]}]}):Response.json({error:{code:'upstream_failure'}},{status:openAIStatus});
  }
  throw new Error(`Unexpected network ${url}`);
 }
 function load(file){const resolved=path.resolve('api-worker/src',file+'.ts');if(modules.has(resolved))return modules.get(resolved);const module={exports:{}};modules.set(resolved,module.exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name==='jose'?{...jose,createRemoteJWKSet:()=>publicKey}:load(path.join(path.dirname(file),name)),Date:Clock,crypto:webcrypto,fetch:external,Request,Response,URL,URLSearchParams,Headers,TextEncoder,TextDecoder,Uint8Array,File,FormData,AbortSignal,atob,console:{error:()=>{}},setTimeout,clearTimeout});return module.exports;}
 const {RateLimiter}=load('rateLimiter'),{CostGuard}=load('costGuard');
 function namespace(Type,prefix){return{idFromName:n=>n,get:n=>({fetch:(url,init)=>new Type(state(prefix+n),env).fetch(new Request(url,init))})};}
 env.RATE_LIMITER=namespace(RateLimiter,'rate:');env.COST_GUARD=namespace(CostGuard,'cost:');
 const worker=load('index').default;
 async function token(uid='alice',claims={}){return new jose.SignJWT({email_verified:true,auth_time:Math.floor(Date.now()/1000),...claims}).setProtectedHeader({alg:'RS256'}).setAudience(env.FIREBASE_PROJECT_ID).setIssuer(`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`).setSubject(uid).setIssuedAt().setExpirationTime('1h').sign(privateKey);}
 async function request(route,body,auth,headers={}){if(auth===undefined)auth=await token();return worker.fetch(new Request('https://worker.example'+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...headers},body:typeof body==='string'?body:JSON.stringify(body)}),env);}
 let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
 const validImage={imageBase64:'/9j/AAAA',mimeType:'image/jpeg',aiConsent:true};
 await check('missing auth rejected before upstream',async()=>{calls=[];assert.equal((await request('/analyze-clothing',validImage,'')).status,401);assert.deepEqual(calls,[]);});
 await check('invalid JWT signature rejected',async()=>{const invalid=(await token()).slice(0,-10)+'invalidxxx';assert.equal((await request('/analyze-clothing',validImage,invalid)).status,401);});
 await check('unverified email rejected',async()=>{calls=[];assert.equal((await request('/analyze-clothing',validImage,await token('alice',{email_verified:false}))).status,403);assert.deepEqual(calls,[]);});
 await check('revoked session rejected',async()=>{accountOverride={localId:'alice',emailVerified:true,validSince:String(Math.ceil(Date.now()/1000)+60)};assert.equal((await request('/analyze-clothing',validImage)).status,401);accountOverride=null;});
 await check('disabled account rejected',async()=>{accountOverride={localId:'alice',emailVerified:true,disabled:true};assert.equal((await request('/analyze-clothing',validImage)).status,401);accountOverride=null;});
 await check('foreign CORS origin rejected',async()=>{assert.equal((await request('/analyze-clothing',validImage,await token(),{Origin:'https://evil.example'})).status,403);});
 await check('AI without explicit consent rejected',async()=>{assert.equal((await request('/analyze-clothing',{...validImage,aiConsent:false})).status,403);});
 await check('foreign object delete rejected',async()=>{calls=[];assert.equal((await request('/delete-object',{key:'wardrobe/bob/12345678-1234-1234-1234-123456789012.jpg'})).status,403);assert.ok(!calls.includes('r2-delete'));});
 await check('malformed types return 400',async()=>{for(const body of ['null','[]','{"message":1,"wardrobe":[]}'])assert.equal((await request('/generate-outfit',body)).status,body.includes('message')?403:400);});
 await check('bounded JSON without Content-Length',async()=>{assert.equal((await request('/generate-outfit',{message:'x'.repeat(33_000),aiConsent:true})).status,413);});
 await check('invalid image never reaches OpenAI',async()=>{calls=[];assert.equal((await request('/analyze-clothing',{...validImage,imageBase64:'aGVsbG8='})).status,400);assert.ok(!calls.includes('openai'));});
 await check('free user cannot analyze even with forged pro body',async()=>{calls=[];const result=await request('/analyze-clothing',{...validImage,pro:true},await token('free'));assert.equal(result.status,403);assert.equal((await result.json()).code,'pro_required');assert.ok(!calls.includes('openai'));});
 await check('valid AI consumes both quotas',async()=>{calls=[];assert.equal((await request('/analyze-clothing',validImage)).status,200);assert.equal(calls.filter(c=>c==='openai').length,1);assert.equal(state('rate:alice').data.get('usage').count,1);assert.equal(state('cost:global-budget-v1').data.get('budget').reservedCents,5);});
 await check('parallel duplicate cannot dispatch twice',async()=>{const a=await token('parallel');calls=[];const results=await Promise.all([request('/analyze-clothing',validImage,a),request('/analyze-clothing',validImage,a)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(calls.filter(c=>c==='openai').length,1);});
 await check('failed provider attempt remains charged',async()=>{openAIStatus=500;assert.equal((await request('/analyze-clothing',validImage,await token('failure'))).status,502);assert.equal(state('rate:failure').data.get('usage').count,1);assert.equal((await request('/analyze-clothing',validImage,await token('failure'))).status,429);openAIStatus=200;});
 await check('global budget shared across new accounts',async()=>{env.AI_MONTHLY_BUDGET_CENTS='15';calls=[];assert.equal((await request('/analyze-clothing',validImage,await token('newaccount'))).status,429);assert.ok(!calls.includes('openai'));});
 await check('zero budget fails closed',async()=>{env.AI_MONTHLY_BUDGET_CENTS='0';calls=[];assert.equal((await request('/analyze-clothing',validImage,await token('zerobudget'))).status,429);assert.ok(!calls.includes('openai'));});
 await check('AI kill switch before auth and billing',async()=>{env.AI_ENABLED='false';calls=[];assert.equal((await request('/analyze-clothing',validImage)).status,503);assert.deepEqual(calls,[]);env.AI_ENABLED='true';});
 await check('missing budget binding fails closed',async()=>{const binding=env.COST_GUARD;env.COST_GUARD=null;assert.equal((await request('/analyze-clothing',validImage,await token('missingbinding'))).status,503);env.COST_GUARD=binding;});
 await check('deletion requires recent login before mutation',async()=>{assert.equal((await request('/delete-account',{},await token('old',{auth_time:Math.floor(Date.now()/1000)-600}))).status,401);assert.equal(state('rate:old').data.size,0);});
 await check('missing deletion config preserves access',async()=>{assert.equal((await request('/delete-account',{})).status,503);assert.equal(state('rate:alice').data.get('deleting'),undefined);});
 await check('invalid media path never reads storage',async()=>{calls=[];assert.equal((await worker.fetch(new Request('https://worker.example/media/not-an-image?token=x'),env)).status,404);assert.deepEqual(calls,[]);});
 const guard=new CostGuard(state('isolated'),{AI_ENABLED:'true',AI_RESERVATION_CENTS:'5',AI_MONTHLY_BUDGET_CENTS:'10',AI_DAILY_REQUEST_LIMIT:'100',AI_MONTHLY_REQUEST_LIMIT:'1000'});
 await check('atomic concurrent global budget ceiling',async()=>{const results=await Promise.all(Array.from({length:10},()=>guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))));assert.equal(results.filter(r=>r.status===200).length,2);});
 await check('budget survives daily rollover',async()=>{now+=86400_000;assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,429);});
 await check('budget resets at UTC monthly rollover',async()=>{now=Date.UTC(2026,11,1);assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,200);});
 await check('global media reads bounded',async()=>{
  const st=state('media-limit');st.data.set('budget',{day:new Clock().toISOString().slice(0,10),month:new Clock().toISOString().slice(0,7),dailyMedia:5000,monthlyMedia:5000,lifetimeBytes:0,dailyAi:0,monthlyAi:0,reservedCents:0,dailyUploads:0,monthlyUploads:0});
  const guard=new CostGuard(st,{});assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"media"}'}))).status,429);
 });

 await check('monthly storage cap resets with the month, lifetime counter migrated away',async()=>{
  const month=new Clock().toISOString().slice(0,7),st=state('storage-limit');
  st.data.set('budget',{day:new Clock().toISOString().slice(0,10),month,dailyMedia:0,monthlyMedia:0,monthlyBytes:5*1024**3,dailyAi:0,monthlyAi:0,reservedCents:0,dailyUploads:0,monthlyUploads:0});
  const g=new CostGuard(st,{}),up=b=>g.fetch(new Request('https://budget',{method:'POST',body:JSON.stringify({kind:'upload',bytes:b})}));
  assert.equal((await up(100)).status,429);
  st.data.set('budget',{...st.data.get('budget'),month:'2020-01',day:'2020-01-01'});assert.equal((await up(100)).status,200);
  st.data.set('budget',{...st.data.get('budget'),lifetimeBytes:5*1024**3,monthlyBytes:undefined});assert.equal((await up(100)).status,200);assert.equal('lifetimeBytes' in st.data.get('budget'),false);
 });
 await check('storage refund on delete lowers the monthly counter (current month only)',async()=>{
  const st=state('refund'),g=new CostGuard(st,{}),post=b=>g.fetch(new Request('https://budget',{method:'POST',body:JSON.stringify(b)})),month=new Clock().toISOString().slice(0,7);
  await post({kind:'upload',bytes:1000});await post({kind:'refund',bytes:400,month});assert.equal(st.data.get('budget').monthlyBytes,600);
  await post({kind:'refund',bytes:400,month:'1999-01'});assert.equal(st.data.get('budget').monthlyBytes,600);
  await post({kind:'refund',bytes:5000,month});assert.equal(st.data.get('budget').monthlyBytes,0);
 });
 await check('malformed CostGuard body returns 400, not 500',async()=>{const g=new CostGuard(state('bad-json'),{});assert.equal((await g.fetch(new Request('https://budget',{method:'POST',body:'not json'}))).status,400);assert.equal((await g.fetch(new Request('https://budget',{method:'POST',body:'null'}))).status,400);});
 await check('caps are configurable via vars (defaults: 1 cent, 500/day)',async()=>{
  const g=new CostGuard(state('vars'),{AI_ENABLED:'true',AI_MONTHLY_BUDGET_CENTS:'500',AI_MONTHLY_REQUEST_LIMIT:'1000'});
  for(let i=0;i<500;i++)assert.equal((await g.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,200);
  assert.equal((await g.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,429);
  assert.equal(state('vars').data.get('budget').reservedCents,500);
  const u=new CostGuard(state('vars2'),{UPLOAD_DAILY_GLOBAL_LIMIT:'1'}),up=()=>u.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"upload","bytes":10}'}));
  assert.equal((await up()).status,200);assert.equal((await up()).status,429);
 });
 await check('per-user upload burst and daily caps',async()=>{
  const limiter=new RateLimiter(state('upload-limit'));
  const upload=()=>limiter.fetch(new Request('https://rate-limit/upload',{method:'POST',body:'{"bytes":100}'}));
  assert.equal((await upload()).status,200);assert.equal((await upload()).status,429);
  for(let i=0;i<9;i++){now+=3001;assert.equal((await upload()).status,200);}
  now+=3001;assert.equal((await upload()).status,429);
 });
 await check('old AI lease retains charged count',async()=>{
  const st=state('lease');st.data.set('usage',{date:new Clock().toISOString().slice(0,10),count:24,lastRequestAt:now-70000,pending:{id:'lost'}});
  const limiter=new RateLimiter(st);assert.equal((await limiter.fetch(new Request('https://rate-limit/reserve',{method:'POST',body:'{}'}))).status,200);assert.equal(st.data.get('usage').count,25);
  now+=70000;assert.equal((await limiter.fetch(new Request('https://rate-limit/reserve',{method:'POST',body:'{}'}))).status,429);
 });

 const KEY='wardrobe/alice/12345678-1234-1234-1234-123456789012.jpg',TOKEN='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const media=(key,tok,ip='1.1.1.1')=>worker.fetch(new Request('https://worker.example/media/'+key+'?token='+tok,{headers:{'CF-Connecting-IP':ip}}),env);
 await check('S1: junk /media/ requests never consume the global media budget',async()=>{
  states.delete('cost:global-budget-v1');calls=[];
  for(let i=0;i<20;i++)assert.equal((await media(KEY,TOKEN,'9.9.9.'+i)).status,404);
  store.set(KEY,{size:3,uploaded:new Clock(),httpEtag:'e',customMetadata:{accessToken:TOKEN}});
  for(let i=0;i<5;i++)assert.equal((await media(KEY,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','8.8.8.'+i)).status,404);
  assert.equal(states.has('cost:global-budget-v1'),false);assert.ok(!calls.includes('r2-get'));
 });
 await check('S1: valid hit consumes exactly one media unit, wrong token none',async()=>{
  assert.equal((await media(KEY,TOKEN)).status,200);assert.equal(state('cost:global-budget-v1').data.get('budget').dailyMedia,1);
 });
 await check('S1: per-IP media throttle (600 / 10 min), other IPs unaffected',async()=>{
  for(let i=0;i<600;i++)assert.equal((await media(KEY,TOKEN,'7.7.7.7')).status,200);
  const blocked=await media(KEY,TOKEN,'7.7.7.7');assert.equal(blocked.status,429);
  assert.equal((await media(KEY,TOKEN,'6.6.6.6')).status,200);
 });
 const jpeg=(...segments)=>Uint8Array.from([0xff,0xd8,...segments.flat(),0xff,0xda,0,2,1,2,3,0xff,0xd9]);
 const exif=[0xff,0xe1,0,8,69,120,105,102,0,0];const app0=[0xff,0xe0,0,4,74,70];
 async function upload(bytes,name,type,folder='gallery',uid='uploader'){const form=new FormData();form.set('folder',folder);form.set('file',new File([bytes],name,{type}));return worker.fetch(new Request('https://worker.example/upload-image',{method:'POST',headers:{Authorization:'Bearer '+await token(uid)},body:form}),env);}
 await check('S7: JPEG EXIF/XMP stripped server-side, other segments kept',async()=>{
  const res=await upload(jpeg(app0,exif),'a.jpg','image/jpeg');assert.equal(res.status,200);const body=await res.json();
  const saved=store.get(body.key).bytes;assert.deepEqual([...saved],[...jpeg(app0)]);assert.ok(body.key.endsWith('.jpg'));
 });
 await check('S7: extension derives from validated MIME; mismatching file name rejected',async()=>{
  const ok=await upload(jpeg(),'photo.JPEG','image/jpeg','avatars','uploader2');assert.equal(ok.status,200);assert.ok((await ok.json()).key.endsWith('.jpg'));
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  assert.equal((await upload(png,'evil.heic','image/png','gallery','uploader3')).status,415);
  const noExt=await upload(png,'blob','image/png','gallery','uploader4');assert.equal(noExt.status,200);assert.ok((await noExt.json()).key.endsWith('.png'));
  assert.equal((await upload(Uint8Array.from([0xff,0xd8,0xff,0xe1,0xff,0xff,1]),'x.jpg','image/jpeg','gallery','uploader5')).status,415);
 });
 await check('B8: per-user daily upload bytes enforced (50 MB)',async()=>{
  const limiter=new RateLimiter(state('bytes-limit'),{...env,UPLOAD_USER_DAILY_LIMIT:'100'}),up=b=>limiter.fetch(new Request('https://rate-limit/upload',{method:'POST',body:JSON.stringify({bytes:b})}));
  for(let i=0;i<10;i++){assert.equal((await up(5*1024**2)).status,200);now+=3001;}
  assert.equal((await up(5*1024**2)).status,429);
 });
 await check('S12: delete-object is rate limited per user and refunds storage bytes',async()=>{
  const key='gallery/alice/22222222-2222-2222-2222-222222222222.jpg';store.set(key,{size:777,uploaded:new Clock(),customMetadata:{accessToken:TOKEN}});
  const guard=state('cost:global-budget-v1');guard.data.set('budget',{...guard.data.get('budget'),monthlyBytes:1000});
  assert.equal((await request('/delete-object',{key})).status,200);assert.equal(guard.data.get('budget').monthlyBytes,223);
  let last=200;for(let i=0;i<70&&last!==429;i++)last=(await request('/delete-object',{key})).status;assert.equal(last,429);
 });
 await check('S12: forced subscription refresh honoured at most every 5 s',async()=>{
  let rc=0;const before=env.REVENUECAT_SECRET_KEY;const t=await token('refresher');
  const post=force=>request('/subscription-status',{force},t);
  await post(false);const first=await post(true);assert.equal(first.status,200);
  const cache=state('rate:refresher').data.get('plan').at;await post(true);assert.equal(state('rate:refresher').data.get('plan').at,cache);
  now+=6000;await post(true);assert.ok(state('rate:refresher').data.get('plan').at>cache);
 });
 const appCheck=async(claims={},options={})=>new jose.SignJWT({...claims}).setProtectedHeader({alg:'RS256'}).setAudience(options.aud??['projects/123456']).setIssuer(options.iss??'https://firebaseappcheck.googleapis.com/123456').setSubject('1:123456:ios:abc').setIssuedAt().setExpirationTime('1h').sign(privateKey);
 await check('App Check soft mode: invalid/missing allowed, valid allowed',async()=>{
  env.APP_CHECK_ENFORCE='false';
  assert.equal((await request('/analyze-clothing',{...validImage,aiConsent:false},undefined,{'X-Firebase-AppCheck':'garbage'})).status,403);
  assert.equal((await request('/analyze-clothing',{...validImage,aiConsent:false},undefined,{'X-Firebase-AppCheck':await appCheck()})).status,403);
  assert.equal((await request('/analyze-clothing',{...validImage,aiConsent:false})).status,403);
 });
 await check('App Check enforce mode: missing, wrong issuer/audience and garbage rejected',async()=>{
  env.APP_CHECK_ENFORCE='true';const status=async h=>(await request('/analyze-clothing',{...validImage,aiConsent:false},undefined,h)).status;
  assert.equal(await status({}),401);assert.equal(await status({'X-Firebase-AppCheck':'garbage'}),401);
  assert.equal(await status({'X-Firebase-AppCheck':await appCheck({}, {iss:'https://firebaseappcheck.googleapis.com/999'})}),401);
  assert.equal(await status({'X-Firebase-AppCheck':await appCheck({}, {aud:['projects/999']})}),401);
  assert.equal(await status({'X-Firebase-AppCheck':await appCheck()}),403);
  const number=env.FIREBASE_PROJECT_NUMBER;env.FIREBASE_PROJECT_NUMBER='';assert.equal(await status({'X-Firebase-AppCheck':await appCheck()}),503);env.FIREBASE_PROJECT_NUMBER=number;
  env.APP_CHECK_ENFORCE='false';
 });
 await check('S13: unknown provider errors are not echoed',async()=>{
  env.AI_MONTHLY_BUDGET_CENTS='1000';
  openAIStatus=404;const res=await request('/analyze-clothing',validImage,await token('modelmissing'));const body=await res.json();openAIStatus=200;
  assert.equal(res.status,502);assert.ok(!/model/i.test(body.error));
 });
 await check('#12: OPENAI_MODEL var selects the model (default gpt-6-luna)',async()=>{
  env.OPENAI_MODEL='custom-model';calls=[];assert.equal((await request('/analyze-clothing',validImage,await token('modelvar'))).status,200);assert.ok(calls.includes('openai'));env.OPENAI_MODEL=undefined;
 });
 console.log(`${passed} Worker security and cost cases passed. No paid API calls were made.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
