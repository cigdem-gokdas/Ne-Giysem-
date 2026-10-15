import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors } from '../theme';
export function DeletionRecoveryScreen() {
  const { user, deleteAccount, logout } = useAuth();
  const [password,setPassword]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
  return <ScreenFrame includeBottom><View style={{flex:1,justifyContent:'center',padding:28,gap:20}}>
    <Text style={{color:colors.text,fontSize:24}}>Hesap silmeyi tamamla</Text>
    <Text style={{color:colors.textMuted,lineHeight:22}}>Önceki silme işlemi yarım kalmış. Verilerin yeniden erişime açılmadı. Temizliği kaldığı yerden tamamlayabilirsin.</Text>
    {user?.authProvider==='local'&&<TextInput accessibilityLabel="Mevcut şifre" secureTextEntry value={password} onChangeText={setPassword} placeholder="Mevcut şifren" placeholderTextColor={colors.textMuted} style={{color:colors.text,padding:14,borderWidth:1,borderColor:colors.border}} />}
    {!!error&&<Text style={{color:colors.pink}}>{error}</Text>}
    {busy?<ActivityIndicator color={colors.sage}/>:<Pressable onPress={()=>{setBusy(true);setError('');void deleteAccount(password).catch(cause=>setError(cause.message)).finally(()=>setBusy(false));}}><Text style={{color:colors.pink,paddingVertical:12}}>Silmeyi tamamla</Text></Pressable>}
    {!busy&&<Pressable onPress={()=>{void logout().catch(cause=>setError(cause.message));}}><Text style={{color:colors.sage}}>Çıkış yap</Text></Pressable>}
  </View></ScreenFrame>;
}
