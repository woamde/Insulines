import type { ThemeColors } from "@/src/theme";
import type { ProfileData } from "@/src/types";

export type GlucoseZone = "hypo" | "inRange" | "high" | "veryHigh";

export interface Targets {
  low: number;
  high: number;
}

export const DEFAULT_TARGETS: Targets = { low: 70, high: 180 };

export function targetsOf(profile?: { target_low?: number; target_high?: number } | null): Targets {
  if (!profile || !profile.target_low || !profile.target_high) return DEFAULT_TARGETS;
  return { low: profile.target_low, high: profile.target_high };
}

export function glucoseZone(value: number, targets: Targets = DEFAULT_TARGETS): GlucoseZone {
  if (value < targets.low) return "hypo";
  if (value <= targets.high) return "inRange";
  if (value <= 250) return "high";
  return "veryHigh";
}

export function zoneColor(zone: GlucoseZone, colors: ThemeColors): string {
  switch (zone) {
    case "hypo":
      return colors.error;
    case "inRange":
      return colors.success;
    case "high":
      return colors.warning;
    case "veryHigh":
      return colors.error;
  }
}

export function formatGlucose(value: number): string {
  return `${Math.round(value)} mg/dL`;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function roundHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

export function parseNum(text: string): number | null {
  const v = parseFloat(text.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export interface BolusResult {
  mealUnits: number;
  correctionUnits: number;
  total: number;
  warning: string | null;
}

export function calcBolus(opts: {
  carbs: number;
  glucose: number | null;
  profile: Pick<ProfileData, "ic_ratio" | "isf" | "target_glucose">;
}): BolusResult {
  const { carbs, glucose, profile } = opts;
  const ic = profile.ic_ratio > 0 ? profile.ic_ratio : 10;
  const isf = profile.isf > 0 ? profile.isf : 30;
  const mealUnits = carbs > 0 ? carbs / ic : 0;
  const correctionUnits =
    glucose != null && glucose > profile.target_glucose
      ? (glucose - profile.target_glucose) / isf
      : 0;
  const total = Math.max(0, mealUnits + correctionUnits);
  let warning: string | null = null;
  if (glucose != null && glucose < 70) {
    warning = `Hypoglycémie (${Math.round(glucose)} mg/dL) : traitez avec des sucres rapides avant d'injecter.`;
  } else if (glucose != null && glucose > 250) {
    warning = "Hyperglycémie importante : pensez à vérifier vos cétones.";
  }
  return { mealUnits: round1(mealUnits), correctionUnits: round1(correctionUnits), total: round1(total), warning };
}

// ---------------------------------------------------------------------------
// Dates (fr-FR) corrigées pour éviter les décalages de fuseau horaire
// ---------------------------------------------------------------------------
function parseISO(iso: string): Date {
  if (!iso) return new Date();
  if (!iso.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
    return new Date(iso + "Z");
  }
  return new Date(iso);
}

export function isSameDay(iso: string, ref: Date): boolean {
  const d = parseISO(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

export function formatTime(iso: string): string {
  return parseISO(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(iso: string): string {
  const d = parseISO(iso);
  const today = new Date();
  if (isSameDay(iso, today)) return "Aujourd'hui";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(iso, yesterday)) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function relTime(iso: string): string {
  const diffMin = Math.round((Date.now() - parseISO(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return formatDayLabel(iso).toLowerCase();
}

export const SOURCE_LABELS: Record<string, string> = {
  dexcom: "Dexcom",
  libre: "FreeStyle Libre",
  nightscout: "Nightscout",
};

export function zoneLabel(zone: GlucoseZone): string {
  switch (zone) {
    case "hypo":
      return "Hypoglycémie";
    case "inRange":
      return "Dans la cible";
    case "high":
      return "Hyperglycémie";
    case "veryHigh":
      return "Hyperglycémie sévère";
  }
}

export const CONTEXT_LABELS: Record<string, string> = {
  "a-jeun": "À jeun",
  "avant-repas": "Avant repas",
  "apres-repas": "Après repas",
  coucher: "Coucher",
};

export const MEAL_TYPE_LABELS: Record<string, string> = {
  "petit-dejeuner": "Petit-déjeuner",
  dejeuner: "Déjeuner",
  diner: "Dîner",
  collation: "Collation",
  repas: "Repas",
};

export const INSULIN_KIND_LABELS: Record<string, string> = {
  basale: "Basale",
  bolus: "Bolus",
  correction: "Correction",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  marche: "Marche",
  course: "Course",
  velo: "Vélo",
  natation: "Natation",
  musculation: "Musculation",
  autre: "Autre",
};

export const INTENSITY_LABELS: Record<string, string> = {
  legere: "Légère",
  moderee: "Modérée",
  intense: "Intense",
};