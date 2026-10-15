const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source=ts.transpileModule(fs.readFileSync('src/config/securePersistence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const plain=new Map(),secure=new Map();let failAt=Infinity,sets=0;
const storage={getItem:async k=>plain.get(k)??null,setItem:async(k,v)=>plain.set(k,v),removeItem:async k=>plain.delete(k)};
const keychain={WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async k=>secure.get(k)??null,setItemAsync:async(k,v)=>{if(++sets===failAt)throw Error('keychain locked');assert.ok(Buffer.byteLength(v,'utf8')<=2048);secure.set(k,v);},deleteItemAsync:async k=>secure.delete(k)};
function load(){const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:name=>name.includes('async-storage')?storage:name==='expo-secure-store'?keychain:{randomUUID:crypto.randomUUID,CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,v)=>crypto.createHash('sha256').update(v).digest('hex')}});return module.exports.securePersistence;}
async function main(){let adapter=load();
 plain.set('firebase:user','legacy-secret');assert.equal(await adapter.getItem('firebase:user'),'legacy-secret');assert.ok(!plain.has('firebase:user'));
 const large='ş🙂'.repeat(5000);await adapter.setItem('firebase:user',large);assert.equal(await adapter.getItem('firebase:user'),large);
 failAt=sets+2;await assert.rejects(()=>adapter.setItem('firebase:user','new'.repeat(1000)));failAt=Infinity;assert.equal(await adapter.getItem('firebase:user'),large);
 await Promise.all([adapter.setItem('firebase:user','first'),adapter.setItem('firebase:user','second')]);assert.equal(await adapter.getItem('firebase:user'),'second');
 await adapter.removeItem('firebase:user');assert.equal(await adapter.getItem('firebase:user'),null);assert.equal(secure.size,0);
 await adapter.setItem('firebase:user','old-install-session');plain.clear();adapter=load();await adapter.setItem('firebase:test','availability-probe');await adapter.removeItem('firebase:test');assert.equal(await adapter.getItem('firebase:user'),null);
 console.log('Secure storage: migration, Unicode size, atomic failures, serialization, logout, reinstall passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
