export interface MealItem {
  name: string;
  grams: number;
  carbs_per_100g: number;
  carbs_g: number;
}

export interface MealEntry {
  id: string;
  meal_type: string;
  name: string;
  photo_path: string | null;
  items: MealItem[];
  carbs_g: number;
  glucose_before: number | null;
  insulin_units: number | null;
  note: string;
  eaten_at: string;
}

export interface GlucoseReading {
  id: string;
  value_mgdl: number;
  context: string;
  note: string;
  source?: string;
  measured_at: string;
}

export interface ProfileData {
  id: string;
  name: string;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  diabetes_years: number | null;
  ic_ratio: number;
  isf: number;
  target_glucose: number;
  target_low: number;
  target_high: number;
  tir_goal: number;
  doctor_name: string;
  doctor_email: string;
  glucose_unit: "mgdl" | "mmol";
  profile_completed: boolean;
}

export interface StatsData {
  days: number;
  readings_count: number;
  target_low: number;
  target_high: number;
  tir_goal: number;
  avg_glucose: number | null;
  est_hba1c: number | null;
  hypo_count: number;
  hyper_count: number;
  tir_low: number;
  tir_in: number;
  tir_high: number;
  insulin_total: number;
  basal_total: number;
  bolus_total: number;
  basal_daily_avg: number;
  carbs_total: number;
  weight_start: number | null;
  weight_end: number | null;
  weight_delta: number | null;
  weight_count: number;
  activity_count: number;
  activity_minutes: number;
  series: { value_mgdl: number; measured_at: string }[];
}

export type ActivityType = "marche" | "course" | "velo" | "natation" | "musculation" | "autre";
export type ActivityIntensity = "legere" | "moderee" | "intense";

export interface ActivityEntry {
  id: string;
  activity_type: ActivityType;
  duration_min: number;
  intensity: ActivityIntensity;
  note: string;
  started_at: string;
  effect: { before_avg: number | null; after_avg: number | null; delta: number | null; hypo_after: boolean };
}

export interface ShareLink {
  id: string;
  token: string;
  label: string;
  alert_email: string;
  alerts_sent: number;
  last_alert_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
  views: number;
}

export interface SharedView {
  owner_name: string;
  label: string;
  unit: "mgdl" | "mmol";
  target_low: number;
  target_high: number;
  latest: { value_mgdl: number; measured_at: string; source: string; delta: number | null } | null;
  summary_24h: {
    readings_count: number;
    avg: number | null;
    tir_in: number | null;
    hypo_count: number;
    hyper_count: number;
    carbs_g: number;
    bolus_units: number;
    basal_units: number;
    meals_count: number;
  };
  series: { value_mgdl: number; measured_at: string }[];
  generated_at: string;
}

export type InsulinKind = "basale" | "bolus" | "correction";

export interface InsulinDose {
  id: string;
  units: number;
  kind: InsulinKind;
  insulin_name: string;
  note: string;
  injected_at: string;
}

export interface WeightEntry {
  id: string;
  weight_kg: number;
  note: string;
  measured_at: string;
}

export interface Reminder {
  id: string;
  label: string;
  hour: number;
  minute: number;
  enabled: boolean;
  kind: "glucose" | "basale";
}

export interface Food {
  id: string;
  name: string;
  category: string;
  carbs_per_100g: number;
  portion_g: number;
}

export interface CgmStatus {
  configured: boolean;
  source?: string;
  source_label?: string;
  region?: string;
  last_sync_at?: string | null;
  last_sync_inserted?: number;
  last_error?: string | null;
}

export type MealType = "petit-dejeuner" | "dejeuner" | "diner" | "collation" | "repas";
