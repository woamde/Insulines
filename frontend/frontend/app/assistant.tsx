import { useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAvoidingView, KeyboardStickyView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useAiChat, useAiMessages, useAiModels, useClearAiMessages, type AiMessage } from "@/src/api";
import { Chip, ChipRow, LoadingState } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

const SUGGESTIONS = [
  "Combien de glucides dans une part de pizza ?",
  "Quels aliments font peu monter la glycémie ?",
  "Comment gérer une hypo pendant le sport ?",
];

export default function Assistant() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();

  const models = useAiModels();
  const messages = useAiMessages();
  const chat = useAiChat();
  const clear = useClearAiMessages();

  const [model, setModel] = useState<string>("");
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<AiMessage>>(null);

  useEffect(() => {
    if (models.data && !model) setModel(models.data.default);
  }, [models.data, model]);

  const data = messages.data ?? [];
  const pending: AiMessage[] = chat.isPending && chat.variables ? [{ role: "user", content: chat.variables.message }] : [];
  const allMessages = [...data, ...pending];

  useEffect(() => {
    if (allMessages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [allMessages.length]);

  const send = (msg?: string) => {
    const message = (msg ?? text).trim();
    if (!message || chat.isPending || !model) return;
    setText("");
    chat.mutate({ message, model }, { onError: (e) => toast.show(e.message, "error") });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="assistant-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={styles.title}>Assistant IA</Text>
          <Text style={styles.subtitle}>Conseils diabète · glucides</Text>
        </View>
        <Pressable
          onPress={() => clear.mutate(undefined, { onSuccess: () => toast.show("Conversation effacée", "success") })}
          style={styles.iconBtn}
          testID="assistant-clear-button"
          accessibilityRole="button"
        >
          <Ionicons name="trash-outline" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.modelRow}>
        <ChipRow>
          {(models.data?.models ?? []).map((m) => (
            <Chip key={m.key} label={m.label} selected={model === m.key} onPress={() => setModel(m.key)} testID={`ai-model-${m.key}`} />
          ))}
        </ChipRow>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {messages.isLoading ? (
          <LoadingState label="Chargement…" />
        ) : allMessages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles" size={30} color={colors.onBrandTertiary} />
            </View>
            <Text style={styles.emptyTitle}>Posez votre question</Text>
            <Text style={styles.emptyText}>Glucides d&apos;un plat, conseils alimentaires, gestion du diabète…</Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} style={styles.suggestion} onPress={() => send(s)} testID="ai-suggestion">
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={allMessages}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={[styles.bubbleRow, item.role === "user" ? styles.bubbleRowUser : styles.bubbleRowAi]}>
                <View style={[styles.bubble, item.role === "user" ? styles.bubbleUser : styles.bubbleAi]}>
                  <Text style={[styles.bubbleText, item.role === "user" && styles.bubbleTextUser]}>{item.content}</Text>
                </View>
              </View>
            )}
            ListFooterComponent={
              chat.isPending ? (
                <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
                  <View style={[styles.bubble, styles.bubbleAi]}>
                    <Text style={styles.typing}>L&apos;assistant réfléchit…</Text>
                  </View>
                </View>
              ) : null
            }
          />
        )}

        <KeyboardStickyView>
          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Écrivez votre message…"
              placeholderTextColor={colors.muted}
              multiline
              testID="assistant-input"
            />
            <Pressable
              style={[styles.sendBtn, (!text.trim() || chat.isPending) && styles.sendBtnDisabled]}
              onPress={() => send()}
              disabled={!text.trim() || chat.isPending}
              testID="assistant-send-button"
              accessibilityRole="button"
            >
              <Ionicons name="arrow-up" size={22} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </KeyboardStickyView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1 },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "500" },
  subtitle: { color: colors.muted, fontSize: 12 },
  modelRow: { paddingBottom: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "500" },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  suggestions: { marginTop: 12, gap: 8, width: "100%" },
  suggestion: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  suggestionText: { color: colors.onSurfaceSecondary, fontSize: 14 },
  messages: { padding: 16, gap: 10 },
  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAi: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleAi: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: colors.onBrandPrimary },
  typing: { color: colors.muted, fontSize: 14, fontStyle: "italic" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.onSurface,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
}));
