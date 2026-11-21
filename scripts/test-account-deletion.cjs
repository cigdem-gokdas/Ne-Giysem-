const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const { webcrypto } = require('node:crypto');
function load(fetch,env,onObjectsDeleted) {
 const module={exports:{}};
 class JWT{setProtectedHeader(){return this;}setIssuer(){return this;}setAudience(){return this;}setIssuedAt(){return this;}setExpirationTime(){return this;}async sign(){return 'test-oauth-assertion';}}
 class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('api-worker/src/accountDeletion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,fetch,AbortSignal,URLSearchParams,encodeURIComponent,crypto:webcrypto,require:n=>n==='jose'?{importPKCS8:async()=>({}),SignJWT:JWT}:{HttpError}});
 return()=>module.exports.deleteAccountChunk(env,'alice','firebase-id-token',onObjectsDeleted);
}
async function b1(){
 // B1: src/data/account.ts must reauthenticate password AND Apple when both providers are linked, and send the code.
 function run(providers){
  const calls=[],posts=[],module={exports:{}};
  const user={uid:'u1',email:'a@b.c',providerData:providers.map(providerId=>({providerId})),getIdTokenResult:async()=>({authTime:new Date().toISOString()})};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/data/account.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,require:n=>({
   'firebase/auth':{EmailAuthProvider:{credential:(e,p)=>'pw:'+p},reauthenticateWithCredential:async(_u,c)=>calls.push(c),signOut:async()=>{}},
   '../config/firebase':{firebaseAuth:{currentUser:user}},
   '../services/workerApi':{workerPost:async(_u,path,body)=>{posts.push(body);return{done:true};}},
   '../auth/apple':{appleCredential:async()=>({credential:'apple-cred',authorizationCode:'apple-code'})},
   '../auth/authErrors':{authErrorMessage:e=>e.message},
  })[n]});
  return module.exports.deleteUserAccount('u1','secret').then(()=>({calls,posts}));
 }
 let r=await run(['password','apple.com']);assert.deepEqual(r.calls,['pw:secret','apple-cred']);assert.equal(r.posts[0].appleAuthorizationCode,'apple-code');
 r=await run(['password']);assert.deepEqual(r.calls,['pw:secret']);assert.equal(r.posts[0].appleAuthorizationCode,undefined);
 r=await run(['apple.com']);assert.deepEqual(r.calls,['apple-cred']);assert.equal(r.posts[0].appleAuthorizationCode,'apple-code');
}
async function main(){
 let calls=[];
 const prefix='projects/demo/databases/(default)/documents/';
 const env={FIREBASE_PROJECT_ID:'demo',FIREBASE_WEB_API_KEY:'public',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo',client_email:'test@example.com',private_key:'fake'}),IMAGES:{list:async({prefix})=>({objects:[...objects].filter(key=>key.startsWith(prefix)).map(key=>({key,size:100,uploaded:new Date()}))}),delete:async keys=>keys.forEach(key=>objects.delete(key))}};
 const data=new Map([
 ['posts/post',{userId:'alice'}],['comments/other',{userId:'bob',postId:'post'}],['notifications/social',{userId:'alice',actorId:'bob',postId:'post'}],
 ['wardrobe/item',{userId:'alice'}],['reports/report',{reporterId:'bob',reportedId:'alice'}],['reports/mine',{reporterId:'alice',reportedId:'bob',targetType:'user',targetId:'bob',reason:'x',createdAt:'2026-01-01T00:00:00.000Z'}],...Array.from({length:45},(_,i)=>['posts/bulk'+i,{userId:'alice'}]),['blocked_users/block',{blockerId:'bob',blockedId:'alice'}],['users/alice',{}],['account_settings/alice',{}],['write_limits/alice',{}],['users/bob',{}],['wardrobe/bob',{userId:'bob'}],
 ]),objects=new Set(['wardrobe/alice/orphan.jpg','gallery/alice/gallery.jpg','avatars/alice/avatar.jpg','wardrobe/bob/keep.jpg']);
 let authDeleted=false, failCommit=false;
 const network=async(url,opt)=>{
  calls.push(String(url));
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'admin-token'});
  if(String(url).includes('accounts:delete')){assert.equal(JSON.parse(opt.body).idToken,'firebase-id-token');authDeleted=true;return Response.json({});}
  assert.equal(opt.headers.Authorization,'Bearer admin-token');
  const body=JSON.parse(opt.body);
  if(String(url).endsWith(':runQuery')){const q=body.structuredQuery,c=q.from[0].collectionId,f=q.where.fieldFilter;assert.equal(q.limit,100);const match=v=>f.op==='IN'?f.value.arrayValue.values.some(x=>x.stringValue===v):v===f.value.stringValue;const fields=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{stringValue:x}]));return Response.json([...data].filter(([key,value])=>key.startsWith(c+'/')&&match(value[f.field.fieldPath])).slice(0,100).map(([key,value])=>({document:{name:prefix+key,...(q.select?{}:{fields:fields(value)})}})));}
  if(failCommit){failCommit=false;return new Response(null,{status:503});}
  for(const w of body.writes){if(w.delete){assert.ok(!w.delete.endsWith('wardrobe/bob'));if(w.delete.includes('/posts/')){const id=w.delete.split('/').pop();assert.ok(![...data].some(([k,v])=>(k.startsWith('comments/')||k.startsWith('likes/')||k.startsWith('notifications/'))&&v.postId===id));}
   if(w.delete.includes('/reports/'))assert.ok(!w.delete.endsWith('reports/report'),'reports against the deleted user must be kept');
   if(w.update&&w.update.name.includes('/reports/'))assert.equal(w.update.fields.reporterId.stringValue,'deleted');data.delete(w.delete.slice(prefix.length));}else data.set(w.update.name.slice(prefix.length),w.update.fields);}
  return Response.json({});
 };
 await assert.rejects(load(network,{...env,FIREBASE_SERVICE_ACCOUNT:undefined}));assert.equal(calls.length,0);
 await assert.rejects(load(network,{...env,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'other',client_email:'x',private_key:'x'})}));assert.equal(calls.length,0);
 const chunk=load(network,env);failCommit=true;await assert.rejects(chunk);assert.ok(data.has('wardrobe/item'));assert.equal(authDeleted,false);
 let refunded=0;const chunk2=load(network,env,async objs=>{refunded+=objs.reduce((n,o)=>n+o.size,0);});
 let done=false,chunks=0;for(let i=0;i<30;i++){chunks++;const result=await chunk2();if(result.done){done=true;break;}}
 assert.equal(refunded,300,'storage refunded per deleted object');
 assert.ok(chunks<=16,'posts are deleted in batches, not one per call (chunks='+chunks+')');
 assert.equal(done,true);assert.equal(authDeleted,true);assert.deepEqual([...objects],['wardrobe/bob/keep.jpg']);const keys=[...data.keys()].sort();assert.equal(keys.length,5);assert.deepEqual(keys.filter(k=>!k.startsWith('reports/deleted_')),['account_deletions/alice','reports/report','users/bob','wardrobe/bob']);
 const anon=[...data].find(([k])=>k.startsWith('reports/deleted_'));assert.ok(anon,'reporter anonymised');assert.equal(anon[1].reporterId.stringValue,'deleted');assert.equal(anon[1].reportedId.stringValue,'bob');assert.ok(!data.has('reports/mine'));
 await b1();
 console.log('B1: password+Apple users send appleAuthorizationCode. ');
 console.log('Account deletion: no-config safety, project binding, transient failure recovery, social children, orphan photos, cross-user isolation, final Auth deletion passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
