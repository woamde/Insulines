import { Linking, Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

import type { Reminder } from "@/src/types";

type NotificationsModule = typeof import("expo-notifications");

// Depuis le SDK 53, expo-notifications n'est plus disponible dans Expo Go sur Android : son simple import
// lève une erreur et ferait planter toute l'application. On ne le charge donc que si l'environnement le permet.
const isExpoGoAndroid = Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const notificationsSupported = Platform.OS !== "web" && !isExpoGoAndroid;
export const notificationsUnsupportedReason = isExpoGoAndroid
  ? "Sur Android, Expo Go ne prend plus en charge les notifications : elles fonctionneront dans l'application installée (APK). Vos horaires sont bien enregistrés."
  : "Les rappels sont envoyés sur votre téléphone : ouvrez GlycoSoin dans Expo Go ou l'application installée pour les activer. Vous pouvez tout de même régler les horaires ici.";

const CHANNEL_ID = "rappels";
let mod: NotificationsModule | null = null;
let handlerInstalled = false;

function notifications(): NotificationsModule | null {
  if (!notificationsSupported) return null;
  if (!mod) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("expo-notifications") as NotificationsModule;
    } catch {
      return null;
    }
  }
  if (!handlerInstalled) {
    handlerInstalled = true;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
  return mod;
}

export type PermissionState = "granted" | "denied" | "blocked" | "undetermined" | "unsupported";

export async function getPermissionState(): Promise<PermissionState> {
  const n = notifications();
  if (!n) return "unsupported";
  const p = await n.getPermissionsAsync();
  if (p.granted) return "granted";
  if (p.status === "undetermined") return "undetermined";
  return p.canAskAgain ? "denied" : "blocked";
}

export async function requestPermission(): Promise<PermissionState> {
  const n = notifications();
  if (!n) return "unsupported";
  const p = await n.requestPermissionsAsync();
  if (p.granted) return "granted";
  return p.canAskAgain ? "denied" : "blocked";
}

export function openSettings() {
  Linking.openSettings();
}

function messageFor(reminder: Reminder): { title: string; body: string } {
  if (reminder.kind === "basale") {
    return { title: "Insuline lente", body: "C'est l'heure de votre insuline basale. Pensez à l'enregistrer dans GlycoSoin." };
  }
  return { title: "Petit rappel glycémie", body: `${reminder.label} : un contrôle rapide de votre glycémie ?` };
}

/** Replanifie toutes les notifications locales à partir de la liste de rappels. */
export async function syncScheduledReminders(reminders: Reminder[]): Promise<number> {
  const n = notifications();
  if (!n) return 0;
  if (Platform.OS === "android") {
    await n.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Rappels GlycoSoin",
      importance: n.AndroidImportance.DEFAULT,
      sound: undefined,
    });
  }
  await n.cancelAllScheduledNotificationsAsync();
  let count = 0;
  for (const r of reminders) {
    if (!r.enabled) continue;
    const { title, body } = messageFor(r);
    await n.scheduleNotificationAsync({
      identifier: `glycosoin-${r.id}`,
      content: { title, body, data: { reminderId: r.id, kind: r.kind } },
      trigger: {
        type: n.SchedulableTriggerInputTypes.DAILY,
        hour: r.hour,
        minute: r.minute,
        channelId: CHANNEL_ID,
      },
    });
    count += 1;
  }
  return count;
}

export async function clearScheduledReminders() {
  const n = notifications();
  if (!n) return;
  await n.cancelAllScheduledNotificationsAsync();
  await n.dismissAllNotificationsAsync();
}

/** Programme un rappel unique de recontrôle 15 min après une hypoglycémie. Renvoie false si impossible. */
export async function scheduleHypoRecheck(minutes = 15): Promise<boolean> {
  const n = notifications();
  if (!n) return false;
  const p = await n.getPermissionsAsync();
  if (!p.granted) return false;
  if (Platform.OS === "android") {
    await n.setNotificationChannelAsync(CHANNEL_ID, { name: "Rappels GlycoSoin", importance: n.AndroidImportance.DEFAULT });
  }
  await n.cancelScheduledNotificationAsync("glycosoin-hypo-recheck").catch(() => undefined);
  await n.scheduleNotificationAsync({
    identifier: "glycosoin-hypo-recheck",
    content: {
      title: "Recontrôle après hypo",
      body: "15 minutes se sont écoulées : mesurez à nouveau votre glycémie et enregistrez-la.",
      data: { kind: "hypo-recheck" },
    },
    trigger: { type: n.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: minutes * 60, channelId: CHANNEL_ID },
  });
  return true;
}
