// Expo inlines EXPO_PUBLIC_ variables into the app bundle at build time.
export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim() ?? '';
