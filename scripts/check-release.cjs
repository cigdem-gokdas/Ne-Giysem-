// Static release checks. This cannot verify live provider billing or console settings.
const fs = require('node:fs');
process.env.NODE_ENV ??= 'production';
require('@expo/env').load(process.cwd());
const failures = [];
const required = ['EXPO_PUBLIC_FIREBASE_API_KEY','EXPO_PUBLIC_FIREBASE_PROJECT_ID','EXPO_PUBLIC_FIREBASE_APP_ID','EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN','EXPO_PUBLIC_WORKER_URL','EXPO_PUBLIC_PRIVACY_URL','EXPO_PUBLIC_TERMS_URL','EXPO_PUBLIC_REVENUECAT_IOS_KEY'];
for (const name of required) {
  const value=process.env[name]?.trim();
  if (!value || /your-|your\.|example|placeholder/i.test(value)) failures.push(`${name}: gerçek üretim değeri gerekli`);
}
for (const name of ['EXPO_PUBLIC_WORKER_URL','EXPO_PUBLIC_PRIVACY_URL','EXPO_PUBLIC_TERMS_URL']) {
  try { const url=new URL(process.env[name]);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error(); }
  catch { failures.push(`${name}: geçerli HTTPS adresi gerekli`); }
}
for (const name of Object.keys(process.env)) if (/^EXPO_PUBLIC_.*(OPENAI|PRIVATE_KEY|SERVICE_ACCOUNT|R2_SECRET|REVENUECAT_SECRET)/i.test(name)) failures.push(`${name}: secret mobil pakete eklenemez`);
const app=JSON.parse(fs.readFileSync('app.json','utf8')).expo;
if(!app.ios.usesAppleSignIn||!app.plugins.includes('expo-apple-authentication')||!app.plugins.includes('expo-secure-store'))failures.push('Apple sign-in / SecureStore yapılandırması eksik');
const worker=fs.readFileSync('api-worker/wrangler.toml','utf8');
const vars=Object.fromEntries([...worker.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map(m=>[m[1],m[2]]));
if(!vars.FIREBASE_WEB_API_KEY)failures.push('Worker FIREBASE_WEB_API_KEY eksik');
if(vars.FIREBASE_PROJECT_ID!==process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID)failures.push('Mobil ve Worker Firebase proje kimlikleri eşleşmeli');
if(vars.AI_ENABLED==='true' && (!/^\d+$/.test(vars.AI_MONTHLY_BUDGET_CENTS??'')||Number(vars.AI_MONTHLY_BUDGET_CENTS)<=0||!Number(vars.AI_DAILY_REQUEST_LIMIT)||!Number(vars.AI_MONTHLY_REQUEST_LIMIT)))failures.push('AI açıkken pozitif bütçe ve çağrı tavanları gerekli');
if(!/^appl_/.test(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY??''))failures.push('RevenueCat iOS production SDK anahtarı gerekli');
if((process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID??'ne_giysem_pro_monthly')!=='ne_giysem_pro_monthly')failures.push('RevenueCat aylık ürün kimliği beklenen App Store ürünüyle eşleşmiyor');
if((process.env.EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID??'ne_giysem_pro_yearly')!=='ne_giysem_pro_yearly')failures.push('RevenueCat yıllık ürün kimliği beklenen App Store ürünüyle eşleşmiyor');
if(vars.REVENUECAT_ALLOW_SANDBOX!=='false')failures.push('Üretim Worker sandbox satın almalarını kabul etmemeli');
if(failures.length){console.error('Yayın yapılandırması hazır değil:\n'+failures.map(x=>' - '+x).join('\n'));process.exitCode=1;}
else console.log('Statik yayın yapılandırması geçerli. Canlı faturalandırma, Worker secretları, Firebase kuralları, TestFlight ve moderasyon doğrulaması ayrıca gereklidir.');
