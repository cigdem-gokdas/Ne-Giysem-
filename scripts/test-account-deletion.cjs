const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(fetch,env) {
 const module={exports:{}};
 class JWT{setProtectedHeader(){return this;}setIssuer(){return this;}setAudience(){return this;}setIssuedAt(){return this;}setExpirationTime(){return this;}async sign(){return 'test-oauth-assertion';}}
 class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('api-worker/src/accountDeletion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date,fetch,AbortSignal,URLSearchParams,encodeURIComponent,require:n=>n==='jose'?{importPKCS8:async()=>({}),SignJWT:JWT}:{HttpError}});
 return()=>module.exports.deleteAccountChunk(env,'alice','firebase-id-token');
}
async function main(){
 let calls=[];
 const prefix='projects/demo/databases/(default)/documents/';
 const env={FIREBASE_PROJECT_ID:'demo',FIREBASE_WEB_API_KEY:'public',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'demo',client_email:'test@example.com',private_key:'fake'}),IMAGES:{list:async({prefix})=>({objects:[...objects].filter(key=>key.startsWith(prefix)).map(key=>({key}))}),delete:async keys=>keys.forEach(key=>objects.delete(key))}};
 const data=new Map([
 ['posts/post',{userId:'alice'}],['comments/other',{userId:'bob',postId:'post'}],['notifications/social',{userId:'alice',actorId:'bob',postId:'post'}],
 ['wardrobe/item',{userId:'alice'}],['reports/report',{reporterId:'bob',reportedId:'alice'}],['blocked_users/block',{blockerId:'bob',blockedId:'alice'}],['users/alice',{}],['account_settings/alice',{}],['write_limits/alice',{}],['users/bob',{}],['wardrobe/bob',{userId:'bob'}],
 ]),objects=new Set(['wardrobe/alice/orphan.jpg','gallery/alice/gallery.jpg','avatars/alice/avatar.jpg','wardrobe/bob/keep.jpg']);
 let authDeleted=false, failCommit=false;
 const network=async(url,opt)=>{
  calls.push(String(url));
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'admin-token'});
  if(String(url).includes('accounts:delete')){assert.equal(JSON.parse(opt.body).idToken,'firebase-id-token');authDeleted=true;return Response.json({});}
  assert.equal(opt.headers.Authorization,'Bearer admin-token');
  const body=JSON.parse(opt.body);
  if(String(url).endsWith(':runQuery')){const q=body.structuredQuery,c=q.from[0].collectionId,f=q.where.fieldFilter;assert.equal(q.limit,100);return Response.json([...data].filter(([key,value])=>key.startsWith(c+'/')&&value[f.field.fieldPath]===f.value.stringValue).slice(0,100).map(([key])=>({document:{name:prefix+key}})));}
  if(failCommit){failCommit=false;return new Response(null,{status:503});}
  for(const w of body.writes){if(w.delete){assert.ok(!w.delete.endsWith('wardrobe/bob'));if(w.delete.endsWith('posts/post'))assert.ok(!data.has('comments/other'));data.delete(w.delete.slice(prefix.length));}else data.set(w.update.name.slice(prefix.length),w.update.fields);}
  return Response.json({});
 };
 await assert.rejects(load(network,{...env,FIREBASE_SERVICE_ACCOUNT:undefined}));assert.equal(calls.length,0);
 await assert.rejects(load(network,{...env,FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'other',client_email:'x',private_key:'x'})}));assert.equal(calls.length,0);
 const chunk=load(network,env);failCommit=true;await assert.rejects(chunk);assert.ok(data.has('wardrobe/item'));assert.equal(authDeleted,false);
 let done=false;for(let i=0;i<30;i++){const result=await chunk();if(result.done){done=true;break;}}
 assert.equal(done,true);assert.equal(authDeleted,true);assert.deepEqual([...objects],['wardrobe/bob/keep.jpg']);assert.deepEqual([...data.keys()].sort(),['account_deletions/alice','users/bob','wardrobe/bob']);
 console.log('Account deletion: no-config safety, project binding, transient failure recovery, social children, orphan photos, cross-user isolation, final Auth deletion passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
