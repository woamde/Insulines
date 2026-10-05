import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips (fixed 36pt, color/border only change when selected)
// ---------------------------------------------------------------------------
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRowContent}
      style={styles.chipRow}
    >
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  testID,
  variant = "primary",
  icon,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  variant?: "primary" | "secondary" | "danger";
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        (disabled || loading) && styles.buttonDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.onBrandPrimary} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[styles.buttonText, variant !== "primary" && styles.buttonTextDark]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  suffix,
  multiline,
  testID,
  hint,
  big,
  secure,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal" | "email";
  suffix?: string;
  multiline?: boolean;
  testID?: string;
  hint?: string;
  big?: boolean;
  secure?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, big && styles.inputBig]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType === "decimal" ? "decimal-pad" : keyboardType === "email" ? "email-address" : keyboardType}
          autoCapitalize={keyboardType === "email" ? "none" : undefined}
          autoCorrect={keyboardType === "email" ? false : undefined}
          multiline={multiline}
          secureTextEntry={secure}
          testID={testID}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header (écrans de pile, sans barre d'onglets)
// ---------------------------------------------------------------------------
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: boolean;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.screenHeader, { paddingTop: insets.top + 8 }]}>
      <View style={styles.screenHeaderRow}>
        {onBack ? (
          <Pressable
            onPress={() => router.back()}
            testID="header-back-button"
            style={styles.headerIcon}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.headerIcon} />
        )}
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        {right ?? <View style={styles.headerIcon} />}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// États : vide / chargement / erreur
// ---------------------------------------------------------------------------
export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.stateBox} testID="empty-state">
      {icon}
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.stateBox} testID="loading-state">
      <ActivityIndicator color={colors.brandPrimary} size="large" />
      {label ? <Text style={styles.stateMessage}>{label}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.stateBox} testID="error-state">
      <Ionicons name="cloud-offline" size={36} color={colors.error} />
      <Text style={styles.stateTitle}>Une erreur est survenue</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} testID="error-retry-button" style={styles.retryButton}>
          <Text style={styles.retryText}>Réessayer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tuiles & badges
// ---------------------------------------------------------------------------
export function StatTile({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.statTile} testID={`stat-tile-${label}`}>
      <Text style={[styles.statTileValue, color ? { color } : null]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.statTileUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

export function Badge({ text, color, testID }: { text: string; color: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]} testID={testID}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    shadowColor: colors.onSurface,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chip: {
    flexShrink: 0,
    height: 36,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandPrimary,
  },
  chipText: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextSelected: {
    color: colors.onBrandTertiary,
  },
  chipRow: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRowContent: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  buttonPrimary: {
    backgroundColor: colors.brandPrimary,
  },
  buttonSecondary: {
    backgroundColor: colors.brandTertiary,
  },
  buttonDanger: {
    backgroundColor: colors.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: colors.onBrandPrimary,
    fontSize: 15,
    fontWeight: "500",
  },
  buttonTextDark: {
    color: colors.onBrandTertiary,
  },
  field: {
    marginBottom: 4,
  },
  fieldLabel: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    paddingVertical: 12,
  },
  inputBig: {
    fontSize: 28,
    fontWeight: "500",
  },
  inputSuffix: {
    color: colors.muted,
    fontSize: 13,
    marginLeft: 8,
  },
  fieldHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 6,
  },
  screenHeader: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  screenHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "500",
  },
  headerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  stateBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  stateTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  stateMessage: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: colors.onBrandTertiary,
    fontSize: 14,
    fontWeight: "500",
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  statTileValue: {
    color: colors.onSurface,
    fontSize: 19,
    fontWeight: "500",
  },
  statTileUnit: {
    fontSize: 12,
    fontWeight: "400",
  },
  statTileLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
}));
