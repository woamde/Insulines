import { useProfile } from "@/src/api";

export type GlucoseUnit = "mgdl" | "mmol";

const MMOL_FACTOR = 18.016;

export function mgdlToMmol(v: number): number {
  return Math.round((v / MMOL_FACTOR) * 10) / 10;
}

export function mmolToMgdl(v: number): number {
  return Math.round(v * MMOL_FACTOR);
}

export interface Units {
  unit: GlucoseUnit;
  /** Libellé de l'unité : "mg/dL" ou "mmol/L" */
  label: string;
  /** Valeur stockée (mg/dL) → nombre affiché dans l'unité choisie */
  fromMgdl: (mgdl: number) => number;
  /** Valeur saisie dans l'unité choisie → mg/dL pour le stockage */
  toMgdl: (display: number) => number;
  /** Valeur stockée (mg/dL) → texte formaté sans unité ("6,4" ou "115") */
  fmt: (mgdl: number) => string;
  /** Delta (mg/dL) → texte signé ("+0,3" ou "+12") */
  fmtDelta: (mgdl: number) => string;
  /** Pas de saisie conseillé et exemple de placeholder */
  placeholder: string;
  isMmol: boolean;
}

export function unitsFor(unit: GlucoseUnit | undefined | null): Units {
  const isMmol = unit === "mmol";
  const fromMgdl = (v: number) => (isMmol ? mgdlToMmol(v) : Math.round(v));
  const fmtNumber = (v: number) => (isMmol ? v.toFixed(1).replace(".", ",") : String(Math.round(v)));
  return {
    unit: isMmol ? "mmol" : "mgdl",
    label: isMmol ? "mmol/L" : "mg/dL",
    isMmol,
    fromMgdl,
    toMgdl: (v: number) => (isMmol ? mmolToMgdl(v) : Math.round(v)),
    fmt: (v: number) => fmtNumber(fromMgdl(v)),
    fmtDelta: (v: number) => {
      const d = fromMgdl(Math.abs(v)) * (v < 0 ? -1 : 1);
      return `${d >= 0 ? "+" : "−"}${fmtNumber(Math.abs(d))}`;
    },
    placeholder: isMmol ? "Ex : 6,5" : "Ex : 120",
  };
}

export function useUnits(): Units {
  const profile = useProfile();
  return unitsFor(profile.data?.glucose_unit);
}
