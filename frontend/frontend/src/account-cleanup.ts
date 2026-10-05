import { Platform } from "react-native";
import { Image } from "expo-image";

import { clearScheduledReminders } from "@/src/notifications";

/** Only app-owned caches, never originals in the user's photo library. */
async function clearFiles() {
  if (Platform.OS === "web") return;
  const { Directory, File, Paths } = await import("expo-file-system");
  for (const entry of new Directory(Paths.cache).list()) {
    if ((entry instanceof File && /^glycosoin-rapport-\d+j\.pdf$/.test(entry.name)) ||
        (entry instanceof Directory && entry.name === "ImagePicker")) {
      entry.delete();
    }
  }
}

export async function clearAccountDeviceData(): Promise<boolean> {
  const tasks: Promise<unknown>[] = [clearScheduledReminders(), clearFiles()];
  if (Platform.OS !== "web") tasks.push(Image.clearMemoryCache(), Image.clearDiskCache());
  const results = await Promise.allSettled(tasks);
  return results.every((result) => result.status === "fulfilled" && result.value !== false);
}