const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, limit, writeBatch, Timestamp, serverTimestamp, getCountFromServer } = require('firebase/firestore');
let tests = 0;
const passes = async (name, action) => { await assertSucceeds(action()); tests++; console.log(`PASS ${name}`); };
const denied = async (name, action) => { await assertFails(action()); tests++; console.log(`PASS denies ${name}`); };
const now = () => new Date().toISOString();
const day = () => { const d=new Date(); return Timestamp.fromMillis(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); };
const profile = (name='user') => ({ username:name, usernameLower:name, avatarUri:null, avatarKey:null, bio:'', role:'user', authProvider:'local', shareGallery:false, shareBoards:false, createdAt:serverTimestamp() });
const garment = (uid) => ({ userId:uid,imageUri:`https://worker.example/media/wardrobe/${uid}/12345678-1234-1234-1234-123456789012.jpg?token=12345678-1234-1234-1234-123456789012`,storageKey:`wardrobe/${uid}/12345678-1234-1234-1234-123456789012.jpg`,tur:'üst',renk:'siyah',desen:'düz',kesim:'normal',altTur:'tişört',kemerUygun:false,createdAt:now() });
async function charged(db, uid, entries, paths=entries.map(([path])=>path)) {
 const budget=doc(db,'write_limits',uid), previous=await getDoc(budget);
 const count=previous.data()?.day?.isEqual(day()) ? previous.data().count : 0;
 const batch=writeBatch(db);
 batch.set(budget,{day:day(),at:serverTimestamp(),count:count+paths.length,paths});
 for(const [path,data,update] of entries) update ? batch.update(doc(db,path),data) : batch.set(doc(db,path),data);
 return batch.commit();
}
async function main() {
 const env=await initializeTestEnvironment({projectId:'demo-ne-giysem',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('firestore.rules','utf8')}});
 try {
 await env.clearFirestore();
 const a=env.authenticatedContext('alice',{email_verified:true}).firestore();
 const b=env.authenticatedContext('bob',{email_verified:true}).firestore();
 const u=env.authenticatedContext('newuser',{email_verified:false}).firestore();
 const guest=env.unauthenticatedContext().firestore();
 const admin=env.authenticatedContext('moderator',{email_verified:true,admin:true}).firestore();
 await passes('unverified profile bootstrap',()=>setDoc(doc(u,'users','newuser'),profile()));
 await denied('unverified private data',()=>getDocs(query(collection(u,'wardrobe'),where('userId','==','newuser'),limit(100))));
 await passes('profile create',()=>setDoc(doc(a,'users','alice'),profile('alice')));
 await passes('second profile',()=>setDoc(doc(b,'users','bob'),profile('bob')));
 await denied('self admin creation',()=>setDoc(doc(u,'users','attacker'),{...profile(),role:'admin'}));
 await denied('role escalation',()=>updateDoc(doc(a,'users','alice'),{role:'admin'}));
 await denied('anonymous profiles',()=>getDoc(doc(guest,'users','alice')));
 await denied('unbounded user scan',()=>getDocs(collection(a,'users')));
 await passes('bounded profile discovery',()=>getDocs(query(collection(a,'users'),limit(50))));
 await denied('quota bypass',()=>setDoc(doc(a,'wardrobe','item'),garment('alice')));
 await denied('direct creation denied even with write budget',()=>charged(a,'alice',[['wardrobe/item',garment('alice')]]));
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'wardrobe','item'),{
   ...garment('alice'),secondaryColors:['krem'],season:['sonbahar'],styleTags:['klasik'],formality:'smart casual',materialGuess:'pamuk tahmini'
 }));
 await passes('owner can manually edit tags',()=>charged(a,'alice',[['wardrobe/item',{renk:'mavi'},true]]));
 await denied('owner cannot forge server AI metadata',()=>charged(a,'alice',[['wardrobe/item',{styleTags:['lüks']},true]]));
 await denied('cross-user read',()=>getDoc(doc(b,'wardrobe','item')));
 await denied('cross-user write',()=>charged(b,'bob',[['wardrobe/item',{renk:'mavi'},true]]));
 await denied('oversized field',()=>charged(a,'alice',[['wardrobe/huge',{...garment('alice'),renk:'x'.repeat(81)}]]));
 await denied('unknown field',()=>charged(a,'alice',[['wardrobe/injected',{...garment('alice'),admin:true}]]));
 await denied('one charge cannot authorize two writes',()=>charged(a,'alice',[['wardrobe/one',garment('alice')],['wardrobe/two',garment('alice')]],['wardrobe/one']));
 await passes('owner bounded query',()=>getDocs(query(collection(a,'wardrobe'),where('userId','==','alice'),limit(100))));
 await denied('over limit query',()=>getDocs(query(collection(a,'wardrobe'),where('userId','==','alice'),limit(101))));
 await passes('read absent own like',()=>getDoc(doc(a,'likes','alice_post')));
 await passes('read absent block',()=>getDoc(doc(a,'blocked_users','alice_bob')));
 await passes('create block',()=>charged(a,'alice',[['blocked_users/alice_bob',{blockerId:'alice',blockedId:'bob',createdAt:now()}]]));
 await denied('blocked user removes block',()=>deleteDoc(doc(b,'blocked_users','alice_bob')));
 await denied('blocked follow',()=>charged(b,'bob',[['follows/bob_alice',{followerId:'bob',followedId:'alice',createdAt:now()}]]));
 await passes('report create',()=>charged(a,'alice',[['reports/alice_bob',{reporterId:'alice',reportedId:'bob',reason:'Taciz',createdAt:now()}]]));
 await denied('reported user reads reporter',()=>getDoc(doc(b,'reports','alice_bob')));
 await denied('reported user deletes report',()=>deleteDoc(doc(b,'reports','alice_bob')));
 await passes('custom claim moderation',()=>getDocs(query(collection(admin,'reports'),limit(50))));
 await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(doc(db,'posts','public'),{userId:'alice',kind:'gallery',isPublic:true,title:'Test',createdAt:now(),imageUri:garment('alice').imageUri,storageKey:'gallery/alice/12345678-1234-1234-1234-123456789012.jpg'});
   await setDoc(doc(db,'posts','private'),{userId:'alice',kind:'gallery',isPublic:false,title:'Test',createdAt:now(),imageUri:garment('alice').imageUri,storageKey:'gallery/alice/12345678-1234-1234-1234-123456789012.jpg'});
 });
 await passes('public profile query constrained by visibility',()=>getDocs(query(collection(b,'posts'),where('userId','==','alice'),where('isPublic','==',true),limit(20))));
 await denied('private post direct read',()=>getDoc(doc(b,'posts','private')));
 await denied('profile query without public constraint',()=>getDocs(query(collection(b,'posts'),where('userId','==','alice'),limit(20))));
 await denied('blocked comment',()=>charged(b,'bob',[['comments/blocked',{userId:'bob',postId:'public',postType:'gallery',text:'hello',createdAt:now()}]]));
 await passes('unblock by creator',()=>deleteDoc(doc(a,'blocked_users','alice_bob')));
 await passes('like public post',()=>charged(b,'bob',[['likes/bob_public',{userId:'bob',postId:'public',postType:'gallery',createdAt:now()}]]));
 await passes('bounded aggregation',()=>getCountFromServer(query(collection(b,'likes'),where('postId','==','public'),limit(50))));
 await denied('unbounded aggregation',()=>getCountFromServer(query(collection(b,'likes'),where('postId','==','public'))));
 const notification={actorId:'bob',userId:'alice',postId:'public',type:'like',sourceId:'bob_public',message:'Bir beğeni',isRead:false,createdAt:now()};
 await passes('notification backed by real like',()=>charged(b,'bob',[['notifications/like_bob_public',notification]]));
 await denied('fabricated notification',()=>charged(b,'bob',[['notifications/like_missing',{...notification,sourceId:'missing'}]]));
 await denied('duplicate notification spam',()=>charged(b,'bob',[['notifications/like_bob_public',notification]]));
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'write_limits','alice'),{day:day(),at:Timestamp.now(),count:150,paths:['wardrobe/item']}));
 await denied('daily write limit',()=>charged(a,'alice',[['wardrobe/item',{renk:'bordo'},true]]));
 await passes('privacy withdrawal at quota',()=>updateDoc(doc(a,'posts','public'),{isPublic:false}));
 await passes('delete still available at quota',()=>deleteDoc(doc(a,'wardrobe','item')));
 await denied('quota reset attack',()=>deleteDoc(doc(a,'write_limits','alice')));
 await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'account_deletions','alice'),{started:Timestamp.now()}));
 await denied('deleted-account stale token reads',()=>getDocs(query(collection(a,'posts'),where('userId','==','alice'),limit(20))));
 console.log(`${tests} Firestore security cases passed.`);
 } finally {await env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
