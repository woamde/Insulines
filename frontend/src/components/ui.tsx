// src/components/ui.tsx
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, TextInputProps, ViewStyle } from 'react-native';

// 1. Champ de saisie sécurisé (contrôlé)
interface TextFieldProps {
  label?: string;
  value?: string | number | null;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps['keyboardType'];
  suffix?: string;
  multiline?: boolean;
  testID?: string;
  hint?: string;
  big?: boolean;
  secure?: boolean;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  suffix,
  multiline,
  testID,
  hint,
  big,
  secure,
}: TextFieldProps) {
  const safeValue = value !== null && value !== undefined ? String(value) : '';

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, big && styles.inputBig]}
          value={safeValue}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          multiline={multiline}
          secureTextEntry={secure}
          testID={testID}
          placeholderTextColor="#999"
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// 2. Carte de contenu
interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Card({ children, style, testID }: CardProps) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

// 3. Bouton interactif
interface ButtonProps {
  title: string;
  onPress: () => void;
  type?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

export function Button({ title, onPress, type = 'primary', disabled, testID, style }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        type === 'secondary' && styles.buttonSecondary,
        type === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.buttonText,
          type === 'secondary' && styles.buttonTextSecondary,
          type === 'danger' && styles.buttonTextDanger,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

// 4. Composants annexes de structure
export function Header({ title, subtitle, testID }: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View style={styles.headerContainer} testID={testID}>
      <Text style={styles.headerTitle}>{title}</Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Badge({ label, color = '#007AFF' }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function Avatar({ size = 40 }: { size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarText}>👤</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#333' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 12 },
  input: { flex: 1, paddingVertical: 10, fontSize: 16, color: '#000' },
  inputBig: { fontSize: 24, fontWeight: 'bold' },
  inputSuffix: { marginLeft: 8, fontSize: 14, color: '#666' },
  fieldHint: { fontSize: 12, color: '#666', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  button: { backgroundColor: '#007AFF', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#007AFF' },
  buttonDanger: { backgroundColor: '#FF3B30' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  buttonTextSecondary: { color: '#007AFF' },
  buttonTextDanger: { color: '#fff' },
  headerContainer: { marginBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#111' },
  headerSubtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, alignSelf: 'flex-start' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  avatar: { backgroundColor: '#e1e4e8', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 20 },
});