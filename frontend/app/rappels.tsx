import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useReminders, useSaveReminders } from "@/src/api";
import {
  getPermissionState,
  notificationsSupported,
  notificationsUnsupportedReason,
  openSettings,
  requestPermission,
  syncScheduledReminders,
  type PermissionState,
} from "@/src/notifications";
import { Card, LoadingState, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import type { Reminder } from "@/src/types";

const STEP_MIN = 15;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function shift(r: Reminder, deltaMin: number): Reminder {
  const total = (r.hour * 60 + r.minute + deltaMin + 24 * 60) % (24 * 60);
  return { ...r, hour: Math.floor(total / 60), minute: total % 60 };
}

export default function Rappels() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const remote = useReminders();
  const save = useSaveReminders();

  const [items, setItems] = useState<Reminder[] | null>(null);
  const [permission, setPermission] = useState<PermissionState>("undetermined");

  useEffect(() => {
    if (remote.data && items === null) setItems(remote.data.reminders);
  }, [remote.data, items]);

  useEffect(() => {
    getPermissionState().then(setPermission);
  }, []);

  const update = (id: string, fn: (r: Reminder) => Reminder) =>
    setItems((prev) => (prev ? prev.map((r) => (r.id === id ? fn(r) : r)) : prev));

  const enableNotifications = async () => {
    const state = await requestPermission();
    setPermission(state);
    if (state === "granted") toast.show("Notifications activées", "success");
    else if (state === "blocked") toast.show("Autorisez les notifications dans les réglages du téléphone", "error");
  };

  const handleSave = async () => {
    if (!items) return;
    save.mutate(items, {
      onSuccess: async (data) => {
        const anyEnabled = data.reminders.some((r) => r.enabled);
        if (notificationsSupported && anyEnabled && permission !== "granted") {
          const state = permission === "blocked" ? permission : await requestPermission();
          setPermission(state);
          if (state !== "granted") {
            toast.show("Rappels enregistrés, mais les notifications sont désactivées sur ce téléphone", "error");
            return;
          }
        }
        try {
          const n = await syncScheduledReminders(data.reminders);
          toast.show(n > 0 ? `${n} rappel${n > 1 ? "s" : ""} programmé${n > 1 ? "s" : ""}` : "Rappels enregistrés", "success");
        } catch {
          toast.show("Rappels enregistrés, programmation impossible sur cet appareil", "error");
        }
        router.back();
      },
      onError: (e) => toast.show(e.message, "error"),
    });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} testID="reminders-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Rappels</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        {!notificationsSupported ? (
          <Card style={styles.infoCard} testID="reminders-web-info">
            <Ionicons name="phone-portrait-outline" size={20} color={colors.onBrandTertiary} />
            <Text style={styles.infoText}>{notificationsUnsupportedReason}</Text>
          </Card>
        ) : permission !== "granted" ? (
          <Card style={styles.permissionCard} testID="reminders-permission-card">
            <View style={styles.permissionRow}>
              <View style={styles.permissionIcon}>
                <Ionicons name="notifications-outline" size={20} color={colors.onBrandTertiary} />
              </View>
              <Text style={styles.permissionText}>
                {permission === "blocked"
                  ? "Les notifications sont bloquées pour GlycoSoin. Autorisez-les dans les réglages pour recevoir vos rappels."
                  : "Autorisez les notifications pour recevoir un petit rappel discret aux moments clés de la journée."}
              </Text>
            </View>
            <PrimaryButton
              label={permission === "blocked" ? "Ouvrir les réglages" : "Activer les notifications"}
              onPress={permission === "blocked" ? openSettings : enableNotifications}
              variant="secondary"
              testID="reminders-enable-button"
            />
          </Card>
        ) : null}

        {items === null ? (
          <LoadingState label="Chargement des rappels…" />
        ) : (
          <>
            <Text style={styles.sectionLabel}>Mesures de glycémie</Text>
            <Card>
              {items.filter((r) => r.kind === "glucose").map((r, idx) => (
                <ReminderRow key={r.id} reminder={r} first={idx === 0} onChange={(fn) => update(r.id, fn)} />
              ))}
            </Card>

            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Insuline lente</Text>
            <Card>
              {items.filter((r) => r.kind === "basale").map((r, idx) => (
                <ReminderRow key={r.id} reminder={r} first={idx === 0} onChange={(fn) => update(r.id, fn)} />
              ))}
              <Text style={styles.helpText}>Un rappel quotidien pour ne pas oublier votre injection de basale.</Text>
            </Card>

            <PrimaryButton label="Enregistrer les rappels" onPress={handleSave} loading={save.isPending} testID="reminders-save-button" />
            <Text style={styles.footNote}>Les rappels sont doux : sans son, ils s&apos;affichent simplement à l&apos;heure choisie.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ReminderRow({ reminder, first, onChange }: { reminder: Reminder; first: boolean; onChange: (fn: (r: Reminder) => Reminder) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.row, !first && styles.rowBorder]} testID={`reminder-row-${reminder.id}`}>
      <View style={styles.rowMain}>
        <Text style={[styles.rowLabel, !reminder.enabled && { color: colors.muted }]}>{reminder.label}</Text>
        <View style={styles.timeRow}>
          <Pressable onPress={() => onChange((r) => shift(r, -STEP_MIN))} style={styles.stepButton} testID={`reminder-minus-${reminder.id}`} accessibilityRole="button" disabled={!reminder.enabled}>
            <Ionicons name="remove" size={18} color={reminder.enabled ? colors.brandPrimary : colors.muted} />
          </Pressable>
          <Text style={[styles.time, !reminder.enabled && { color: colors.muted }]} testID={`reminder-time-${reminder.id}`}>
            {pad(reminder.hour)}:{pad(reminder.minute)}
          </Text>
          <Pressable onPress={() => onChange((r) => shift(r, STEP_MIN))} style={styles.stepButton} testID={`reminder-plus-${reminder.id}`} accessibilityRole="button" disabled={!reminder.enabled}>
            <Ionicons name="add" size={18} color={reminder.enabled ? colors.brandPrimary : colors.muted} />
          </Pressable>
        </View>
      </View>
      <Switch
        value={reminder.enabled}
        onValueChange={(v) => onChange((r) => ({ ...r, enabled: v }))}
        trackColor={{ true: colors.brandPrimary, false: colors.border }}
        thumbColor={colors.surfaceSecondary}
        testID={`reminder-switch-${reminder.id}`}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  infoCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandTertiary,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    color: colors.onBrandTertiary,
    fontSize: 13,
    lineHeight: 18,
  },
  permissionCard: {
    marginBottom: 16,
    gap: 12,
  },
  permissionRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  permissionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionText: {
    flex: 1,
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowMain: {
    flex: 1,
    gap: 6,
  },
  rowLabel: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  time: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "500",
    minWidth: 62,
    textAlign: "center",
  },
  helpText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  footNote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 17,
  },
}));
