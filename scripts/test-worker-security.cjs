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
 const states=new Map(), modules=new Map();
 const env={FIREBASE_PROJECT_ID:'demo-ne-giysem',FIREBASE_WEB_API_KEY:'test-public-key',ALLOWED_ORIGINS:'https://allowed.example',OPENAI_API_KEY:'test-not-a-real-secret',REVENUECAT_SECRET_KEY:'test-revenuecat-key',AI_ENABLED:'true',AI_MONTHLY_BUDGET_CENTS:'100',AI_DAILY_REQUEST_LIMIT:'100',AI_MONTHLY_REQUEST_LIMIT:'1000',IMAGES:{get:async()=>{calls.push('r2-get');return null;},delete:async()=>calls.push('r2-delete'),put:async()=>calls.push('r2-put')}};
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
   calls.push('openai');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.service_tier,'default');assert.ok(body.max_output_tokens<=500);assert.equal(body.model,'gpt-6-luna');
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
 const guard=new CostGuard(state('isolated'),{AI_ENABLED:'true',AI_MONTHLY_BUDGET_CENTS:'10',AI_DAILY_REQUEST_LIMIT:'100',AI_MONTHLY_REQUEST_LIMIT:'1000'});
 await check('atomic concurrent global budget ceiling',async()=>{const results=await Promise.all(Array.from({length:10},()=>guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))));assert.equal(results.filter(r=>r.status===200).length,2);});
 await check('budget survives daily rollover',async()=>{now+=86400_000;assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,429);});
 await check('budget resets at UTC monthly rollover',async()=>{now=Date.UTC(2026,11,1);assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"ai"}'}))).status,200);});
 await check('global media reads bounded',async()=>{
  const st=state('media-limit');st.data.set('budget',{day:new Clock().toISOString().slice(0,10),month:new Clock().toISOString().slice(0,7),dailyMedia:5000,monthlyMedia:5000,lifetimeBytes:0,dailyAi:0,monthlyAi:0,reservedCents:0,dailyUploads:0,monthlyUploads:0});
  const guard=new CostGuard(st,{});assert.equal((await guard.fetch(new Request('https://budget',{method:'POST',body:'{"kind":"media"}'}))).status,429);
 });
 await check('storage high-water cap survives month reset',async()=>{
  const st=state('storage-limit');st.data.set('budget',{day:'2020-01-01',month:'2020-01',dailyMedia:0,monthlyMedia:0,lifetimeBytes:5*1024**3,dailyAi:0,monthlyAi:0,reservedCents:0,dailyUploads:0,monthlyUploads:0});
  assert.equal((await new CostGuard(st,{}).fetch(new Request('https://budget',{method:'POST',body:'{"kind":"upload","bytes":100}'}))).status,429);
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
 console.log(`${passed} Worker security and cost cases passed. No paid API calls were made.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
