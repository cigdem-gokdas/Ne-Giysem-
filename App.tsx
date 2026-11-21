import { SubscriptionProvider } from './src/billing/SubscriptionContext';
import { WardrobeOpening } from './src/components/WardrobeOpening';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/auth/AuthContext';
import { colors } from './src/theme';
import { CloudUploadModal } from './src/components/CloudUploadModal';
import { initAppCheck } from './src/services/appCheck';
import { registerTelemetry } from './src/services/telemetry';

// Crash reporting starts only when EXPO_PUBLIC_SENTRY_DSN is set; App Check is a documented no-op for now.
registerTelemetry();
initAppCheck();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.pink,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <NavigationContainer theme={navigationTheme}>
            <StatusBar style="light" />
            <AppNavigator />
            <CloudUploadModal />
            <WardrobeOpening />
          </NavigationContainer>
        </SubscriptionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
