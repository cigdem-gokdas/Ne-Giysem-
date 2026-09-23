import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClothingItem } from '../data/wardrobe';
import { colors, fonts } from '../theme';
import { MoodBoardCollage } from './MoodBoardCollage';

type Props = {
  text: string;
  sender: 'user' | 'assistant';
  items?: ClothingItem[];
  onSaveBoard?: () => void;
  isSavingBoard?: boolean;
  isSavedBoard?: boolean;
};

export function MessageBubble({ text, sender, items = [], onSaveBoard, isSavingBoard = false, isSavedBoard = false }: Props) {
  const isUser = sender === 'user';
  return (
    <View style={[styles.row, isUser && styles.userRow]}>
      {!isUser && <View style={styles.avatar}><Text style={styles.avatarText}>N</Text></View>}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser && styles.userText]}>{text}</Text>
        {items.length > 0 && (
          <View style={styles.selectedSection}>
            <Text style={styles.selectedLabel}>✦  STİL PANOSU</Text>
            <MoodBoardCollage items={items} />
            {!isUser && onSaveBoard && (
              <Pressable
                style={[styles.saveBoardButton, (isSavingBoard || isSavedBoard) && styles.saveBoardDisabled]}
                onPress={onSaveBoard}
                disabled={isSavingBoard || isSavedBoard}
                accessibilityRole="button"
                accessibilityLabel={isSavedBoard ? 'İlham panosuna kaydedildi' : 'İlham panosuna kaydet'}
              >
                {isSavingBoard ? <ActivityIndicator size="small" color={colors.sage} /> : <Feather name={isSavedBoard ? 'check' : 'bookmark'} size={14} color={colors.sage} />}
                <Text style={styles.saveBoardText}>{isSavedBoard ? 'Panoya kaydedildi' : 'İlham Panosuna Kaydet'}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, maxWidth: '100%' },
  userRow: { justifyContent: 'flex-end' },
  avatar: { width: 27, height: 27, borderRadius: 14, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 2 },
  avatarText: { color: colors.ink, fontFamily: fonts.serif, fontSize: 16, fontWeight: '700' },
  bubble: { maxWidth: '82%', borderRadius: 17, paddingHorizontal: 15, paddingVertical: 12, borderWidth: 1 },
  userBubble: { backgroundColor: colors.lavender, borderColor: colors.lavender, borderBottomRightRadius: 5 },
  assistantBubble: { width: '82%', backgroundColor: colors.surfaceLight, borderColor: colors.border, borderBottomLeftRadius: 5 },
  text: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20 },
  userText: { color: colors.ink },
  selectedSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  selectedLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginBottom: 11 },
  saveBoardButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 13, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.sage, backgroundColor: colors.backgroundRaised },
  saveBoardDisabled: { opacity: 0.65 },
  saveBoardText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
