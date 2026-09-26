import { Feather } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, fonts } from '../theme';
import { WardrobeScreen } from '../screens/WardrobeScreen';
import { OutfitChatScreen } from '../screens/OutfitChatScreen';
import { OutfitHistoryScreen } from '../screens/OutfitHistoryScreen';
import { AddClothingScreen } from '../screens/AddClothingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { UserProfileScreen } from '../screens/UserProfileScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { VerifyEmailScreen } from '../screens/VerifyEmailScreen';

export type RootStackParamList = { MainTabs: undefined; AddClothing: undefined; Settings: undefined; UserProfile: { userId: string } };
export type AuthStackParamList = {
  Auth: undefined;
  ForgotPassword: undefined;
  VerifyEmail: { username: string; email: string; password: string; acceptedTerms: true };
};
export type MainTabParamList = { Discover: undefined; Wardrobe: undefined; OutfitChat: undefined; Profile: undefined };

const Stack = createNativeStackNavigator<RootStackParamList>();
const Auth = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="Discover"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.pink,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: fonts.sans, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginTop: 2 },
        tabBarStyle: { backgroundColor: colors.backgroundRaised, borderTopColor: colors.borderSoft, borderTopWidth: 1, height: 66 + insets.bottom, paddingTop: 7, paddingBottom: 7 + insets.bottom },
        tabBarIcon: ({ color, size }) => <Feather name={route.name === 'Discover' ? 'compass' : route.name === 'Wardrobe' ? 'grid' : route.name === 'OutfitChat' ? 'message-circle' : 'user'} size={size - 2} color={color} />,
      })}
    >
      <Tab.Screen name="Discover" component={DiscoverScreen} options={{ title: 'Keşfet' }} />
      <Tab.Screen name="Wardrobe" component={WardrobeScreen} options={{ title: 'Gardırop' }} />
      <Tab.Screen name="OutfitChat" component={OutfitChatScreen} options={{ title: 'Sohbet' }} />
      <Tab.Screen name="Profile" component={OutfitHistoryScreen} options={{ title: 'Profilim' }} />
    </Tab.Navigator>
  );
}

function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="AddClothing" component={AddClothingScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return <Auth.Navigator screenOptions={{ headerShown: false }}>
    <Auth.Screen name="Auth" component={AuthScreen} />
    <Auth.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    <Auth.Screen name="VerifyEmail" component={VerifyEmailScreen} />
  </Auth.Navigator>;
}

export function AppNavigator() {
  const { user, initializing, initError, retryInit } = useAuth();
  if (initializing || initError) {
    return (
      <ScreenFrame includeBottom>
        <View style={styles.startup}>
          {initializing ? <ActivityIndicator color={colors.sage} /> : <Text style={styles.startupTitle}>Bulut bağlantısı kurulamadı</Text>}
          <Text style={styles.startupText}>{initializing ? 'Stil defterin hazırlanıyor...' : 'Lütfen yeniden dene.'}</Text>
          {initError && <Pressable style={styles.retryButton} onPress={retryInit}><Text style={styles.retryText}>Tekrar dene</Text></Pressable>}
        </View>
      </ScreenFrame>
    );
  }
  return user ? <MainStack key={user.id} /> : <AuthStack />;
}

const styles = StyleSheet.create({
  startup: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  startupTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 24, textAlign: 'center' },
  startupText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, marginTop: 14, textAlign: 'center' },
  retryButton: { backgroundColor: colors.sage, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 11, marginTop: 24 },
  retryText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
});
