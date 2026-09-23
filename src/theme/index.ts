import { Platform } from 'react-native';

export const colors = {
  background: '#271B19',
  backgroundRaised: '#30211E',
  surface: '#3A2925',
  surfaceLight: '#49332D',
  border: '#694A40',
  borderSoft: '#50382F',
  text: '#F3E5D7',
  textMuted: '#C6AEA0',
  textFaint: '#A88D80',
  pink: '#E4B9B4',
  pinkDeep: '#C99395',
  sage: '#B4C4A8',
  lavender: '#C9B9D9',
  gold: '#C5A77A',
  ink: '#30211E',
};

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: Platform.select({ ios: 'Avenir Next', android: 'sans-serif', default: 'sans-serif' }),
};
