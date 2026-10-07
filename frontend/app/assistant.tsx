import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  model?: string;
}

type ModelType = 'gpt' | 'claude' | 'gemini';

// Utilisation de la variable d'environnement pour cibler le backend Render
const API_URL = `${process.env.EXPO_PUBLIC_API_URL}/ai/chat`;

export default function AssistantScreen() {
  const [selectedModel, setSelectedModel] = useState<ModelType>('gemini');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const modelLabels: Record<ModelType, string> = {
    gpt: 'GPT-4o',
    claude: 'Claude 3.5',
    gemini: 'gemini-3.6-flash-lite',
  };

  const sendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          message: text,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `Erreur serveur (${response.status})`);
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: data.reply,
        model: modelLabels[selectedModel],
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error: any) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: `⚠️ Erreur : ${error.message || 'Impossible de contacter le serveur.'}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Assistant GlycoSoin</Text>

        {/* Sélecteur des 3 modèles */}
        <View style={styles.modelSelector}>
          {(['gpt', 'claude', 'gemini'] as ModelType[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[
                styles.modelTab,
                selectedModel === m && styles.modelTabActive,
              ]}
              onPress={() => setSelectedModel(m)}
            >
              <Text
                style={[
                  styles.modelTabText,
                  selectedModel === m && styles.modelTabTextActive,
                ]}
              >
                {modelLabels[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatContainer}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() =>
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptySubtitle}>
              Pose tes questions sur le calcul des glucides, l'insuline ou ton suivi glycémique.
            </Text>

            <TouchableOpacity
              style={styles.chip}
              onPress={() => sendMessage('Bolus pour 60g de glucides ?')}
            >
              <Text style={styles.chipText}>Bolus pour 60g de glucides ?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chip}
              onPress={() => sendMessage('Analyser ma glycémie')}
            >
              <Text style={styles.chipText}>Analyser ma glycémie</Text>
            </TouchableOpacity>
          </View>
        ) : (
          messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.bubble,
                msg.sender === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              {msg.sender === 'assistant' && msg.model && (
                <Text style={styles.modelBadge}>{msg.model}</Text>
              )}
              <Text
                style={[
                  styles.bubbleText,
                  msg.sender === 'user' ? styles.userText : styles.assistantText,
                ]}
              >
                {msg.text}
              </Text>
            </View>
          ))
        )}

        {loading && (
          <View style={[styles.bubble, styles.assistantBubble, styles.loadingBubble]}>
            <ActivityIndicator size="small" color="#0284c7" />
            <Text style={styles.loadingText}>Réflexion en cours...</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Écris ton message..."
          placeholderTextColor="#94a3b8"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => sendMessage()}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendButtonText}>➔</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  modelSelector: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    padding: 3,
  },
  modelTab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  modelTabActive: {
    backgroundColor: '#ffffff',
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.1)',
  },
  modelTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  modelTabTextActive: {
    color: '#0284c7',
  },
  chatContainer: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 24,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  chip: {
    backgroundColor: '#e0f2fe',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  chipText: {
    color: '#0369a1',
    fontWeight: '500',
    fontSize: 14,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#0284c7',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: '#ffffff',
  },
  assistantText: {
    color: '#1e293b',
  },
  modelBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
    marginBottom: 4,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: '#0284c7',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});