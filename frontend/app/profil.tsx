import { useEffect, useState } from "react";
import { Pressable, Text, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "@/src/utils/router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useProfile, useSaveProfile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { unitsFor, type GlucoseUnit } from "@/src/units";
import { parseNum, round1 } from "@/src/glucose";
import { Card, TextField, Button } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

export default function Profil() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const profile = useProfile();
  const save = useSaveProfile();
  const { user, signOut } = useAuth();

  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [diabetesYears, setDiabetesYears] = useState("");
  const [ic, setIc] = useState("");
  const [isf, setIsf] = useState("");
  const [target, setTarget] = useState("");
  const [targetLow, setTargetLow] = useState("");
  const [targetHigh, setTargetHigh] = useState("");
  const [tirGoal, setTirGoal] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorEmail, setDoctorEmail] = useState("");
  const [unit, setUnit] = useState<GlucoseUnit>("mgdl");
  const units = unitsFor(unit);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

  const show = (mgdl: number, u: GlucoseUnit) => {
    const v = unitsFor(u).fromMgdl(mgdl);
    return u === "mmol" ? v.toFixed(1) : String(v);
  };

  const switchUnit = (next: GlucoseUnit) => {
    if (next === unit) return;
    const convert = (text: string) => {
      const n = parseNum(text);
      return n == null ? text : show(units.toMgdl(n), next);
    };
    setIsf(convert(isf));
    setTarget(convert(target));
    setTargetLow(convert(targetLow));
    setTargetHigh(convert(targetHigh));
    setUnit(next);
  };

  useEffect(() => {
    if (profile.data && !initialized) {
      setInitialized(true);
      const p = profile.data;
      const u: GlucoseUnit = p.glucose_unit === "mmol" ? "mmol" : "mgdl";
      setUnit(u);

      const profileName = p.first_name || p.prenom || (p.name !== "Profil" ? p.name : "") || "";
      setName(profileName);

      setAge(p.age != null ? String(p.age) : "");
      setHeight(p.height_cm != null ? String(round1(p.height_cm)) : "");
      setWeight(p.weight_kg != null ? String(round1(p.weight_kg)) : "");
      setDiabetesYears(p.diabetes_years != null ? String(round1(p.diabetes_years)) : "");
      setIc(p.ic_ratio != null ? String(p.ic_ratio) : "");
      
      if (p.isf != null) {
        setIsf(show(p.isf, u));
      }

      const targetVal = p.target_glucose ?? p.target_glycemia;
      if (targetVal != null) {
        setTarget(show(targetVal, u));
      }

      setTargetLow(show(p.target_low ?? 70, u));
      setTargetHigh(show(p.target_high ?? 180, u));
      setTirGoal(String(p.tir_goal ?? 70));
      setDoctorName(p.doctor_name ?? "");
      setDoctorEmail(p.doctor_email ?? "");
    }
  }, [profile.data, initialized]);

  const handleSave = () => {
    const icValue = parseNum(ic);
    const isfTyped = parseNum(isf);
    const targetTyped = parseNum(target);

    if (!icValue || icValue <= 0 || !isfTyped || isfTyped <= 0 || !targetTyped || targetTyped <= 0) {
      toast.show("Renseignez un ratio I/C, un ISF et une cible supérieurs à 0", "error");
      return;
    }

    const isfValue = units.toMgdl(isfTyped);
    const targetValue = units.toMgdl(targetTyped);
    const lowTyped = parseNum(targetLow);
    const highTyped = parseNum(targetHigh);
    const lowValue = lowTyped != null ? units.toMgdl(lowTyped) : 70;
    const highValue = highTyped != null ? units.toMgdl(highTyped) : 180;
    const goalValue = parseNum(tirGoal) ?? 70;

    if (!(lowValue >= 40 && lowValue < highValue && highValue <= 300)) {
      toast.show(`Plage cible invalide : la borne basse doit être inférieure à la borne haute (${units.fmt(40)}–${units.fmt(300)} ${units.label})`, "error");
      return;
    }

    if (!(goalValue > 0 && goalValue <= 100)) {
      toast.show("L'objectif de temps dans la cible doit être entre 1 et 100 %", "error");
      return;
    }

    const emailValue = doctorEmail.trim();
    if (emailValue && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(emailValue)) {
      toast.show("Adresse e-mail du médecin invalide", "error");
      return;
    }

    const profileName = name.trim() || "Profil";

    save.mutate(
      {
        name: profileName,
        first_name: profileName,
        prenom: profileName,
        target_low: lowValue,
        target_high: highValue,
        tir_goal: goalValue,
        doctor_name: doctorName.trim(),
        doctor_email: emailValue,
        glucose_unit: unit,
        age: parseNum(age),
        height_cm: parseNum(height),
        weight_kg: parseNum(weight),
        diabetes_years: parseNum(diabetesYears),
        ic_ratio: icValue,
        isf: isfValue,
        target_glucose: targetValue,
        target_glycemia: targetValue,
        profile_completed: true,
      },
      {
        onSuccess: () => {
          toast.show("Profil enregistré", "success");
          handleBack();
        },
        onError: (e) => toast.show(e.message || "Erreur de sauvegarde", "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.backButton} testID="profile-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Profil</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card testID="personal-info-card">
          {user ? (
            <View style={styles.account} testID="account-row">
              <View style={styles.accountAvatar}>
                <Text style={styles.accountAvatarText}>{(user.name || user.email || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName} numberOfLines={1}>{user.name || "Compte Google"}</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{user.email}</Text>
              </View>
            </View>
          ) : null}
          <Text style={styles.cardTitle}>Informations personnelles</Text>
          <TextField label="Prénom" value={name} onChangeText={setName} placeholder="Votre prénom" testID="profile-name-input" />
          <TextField label="Âge" value={age} onChangeText={setAge} placeholder="Ex : 35" keyboardType="numeric" suffix="ans" testID="profile-age-input" />
          <TextField label="Taille" value={height} onChangeText={setHeight} placeholder="Ex : 170" keyboardType="numeric" suffix="cm" testID="profile-height-input" />
          <TextField label="Poids" value={weight} onChangeText={setWeight} placeholder="Ex : 70" keyboardType="decimal" suffix="kg" testID="profile-weight-input" />
          <TextField
            label="Ancienneté du diabète"
            value={diabetesYears}
            onChangeText={setDiabetesYears}
            placeholder="Ex : 12"
            keyboardType="decimal"
            suffix="ans"
            testID="profile-diabetes-years-input"
          />
        </Card>

        <Card testID="insulin-settings-card">
          <Text style={styles.cardTitle}>Paramètres d&apos;insuline</Text>
          <TextField
            label="Ratio I/C (insuline/glucides)"
            value={ic}
            onChangeText={setIc}
            placeholder="Ex : 10"
            keyboardType="decimal"
            suffix="g / U"
            testID="profile-ic-input"
            hint="Grammes de glucides couverts par 1 unité d'insuline rapide."
          />
          <TextField
            label="Facteur de sensibilité (ISF)"
            value={isf}
            onChangeText={setIsf}
            placeholder={units.isMmol ? "Ex : 1,7" : "Ex : 30"}
            keyboardType="decimal"
            suffix={`${units.label} / U`}
            testID="profile-isf-input"
            hint="Baisse attendue de votre glycémie par 1 unité d'insuline."
          />
          <TextField
            label="Glycémie cible"
            value={target}
            onChangeText={setTarget}
            placeholder={units.isMmol ? "Ex : 6,1" : "Ex : 110"}
            keyboardType={units.isMmol ? "decimal" : "numeric"}
            suffix={units.label}
            testID="profile-target-input"
            hint={`Valeur visée pour les corrections (typiquement ${units.fmt(100)}–${units.fmt(120)} ${units.label}).`}
          />
        </Card>

        <Card testID="unit-card">
          <Text style={styles.cardTitle}>Unité d&apos;affichage des glycémies</Text>
          <View style={styles.unitToggleContainer}>
            <Pressable
              style={[styles.unitButton, unit === "mgdl" && styles.unitButtonActive]}
              onPress={() => switchUnit("mgdl")}
              testID="unit-mgdl"
            >
              <Text style={[styles.unitButtonText, unit === "mgdl" && styles.unitButtonTextActive]}>mg/dL</Text>
            </Pressable>
            <Pressable
              style={[styles.unitButton, unit === "mmol" && styles.unitButtonActive]}
              onPress={() => switchUnit("mmol")}
              testID="unit-mmol"
            >
              <Text style={[styles.unitButtonText, unit === "mmol" && styles.unitButtonTextActive]}>mmol/L</Text>
            </Pressable>
          </View>
          <Text style={styles.unitHint}>
            {unit === "mmol" ? "Exemple : 100 mg/dL = 5,6 mmol/L. Toutes les valeurs, cibles et saisies passent en mmol/L." : "Unité utilisée en France. Passez en mmol/L si votre lecteur l'utilise."}
          </Text>
        </Card>

        <Card testID="targets-card">
          <Text style={styles.cardTitle}>Objectifs personnels</Text>
          <View style={styles.rowFields}>
            <View style={{ flex: 1 }}>
              <TextField label="Cible basse" value={targetLow} onChangeText={setTargetLow} placeholder={units.fmt(70)} keyboardType={units.isMmol ? "decimal" : "numeric"} suffix={units.label} testID="profile-target-low-input" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Cible haute" value={targetHigh} onChangeText={setTargetHigh} placeholder={units.fmt(180)} keyboardType={units.isMmol ? "decimal" : "numeric"} suffix={units.label} testID="profile-target-high-input" />
            </View>
          </View>
          <TextField
            label="Objectif de temps dans la cible"
            value={tirGoal}
            onChangeText={setTirGoal}
            placeholder="70"
            keyboardType="numeric"
            suffix="%"
            testID="profile-tir-goal-input"
            hint={`Fixés avec votre diabétologue. Recommandation générale : ${units.fmt(70)}–${units.fmt(180)} ${units.label} et plus de 70 % du temps dans la cible.`}
          />
        </Card>

        <Card testID="doctor-card">
          <Text style={styles.cardTitle}>Mon diabétologue</Text>
          <TextField label="Nom (optionnel)" value={doctorName} onChangeText={setDoctorName} placeholder="Ex : Dr Martin" testID="profile-doctor-name-input" />
          <TextField
            label="E-mail"
            value={doctorEmail}
            onChangeText={setDoctorEmail}
            placeholder="medecin@exemple.fr"
            keyboardType="email-address"
            testID="profile-doctor-email-input"
            hint="Permet d'envoyer votre rapport PDF en un geste depuis les statistiques."
          />
        </Card>

        <Pressable style={styles.cgmLink} onPress={() => router.push("/cgm")} testID="cgm-settings-link">
          <View style={[styles.cgmLinkIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="bluetooth" size={18} color={colors.onBrandTertiary} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text style={styles.cgmLinkTitle}>Capteur en continu (CGM)</Text>
            <Text style={styles.cgmLinkSubtitle}>Dexcom · FreeStyle Libre · Nightscout</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <Pressable style={styles.cgmLink} onPress={() => router.push("/rappels")} testID="reminders-settings-link">
          <View style={[styles.cgmLinkIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="notifications-outline" size={18} color={colors.onBrandTertiary} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text style={styles.cgmLinkTitle}>Rappels</Text>
            <Text style={styles.cgmLinkSubtitle}>Mesures de glycémie · insuline lente</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <Pressable style={styles.cgmLink} onPress={() => router.push("/import-libreview")} testID="import-settings-link">
          <View style={[styles.cgmLinkIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.onBrandTertiary} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text style={styles.cgmLinkTitle}>Importer mon historique LibreView</Text>
            <Text style={styles.cgmLinkSubtitle}>Fichier CSV exporté depuis libreview.com</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <Pressable style={styles.cgmLink} onPress={() => router.push("/partage")} testID="share-settings-link">
          <View style={[styles.cgmLinkIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="people-outline" size={18} color={colors.onBrandTertiary} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text style={styles.cgmLinkTitle}>Partage avec un proche</Text>
            <Text style={styles.cgmLinkSubtitle}>Lien en lecture seule : dernière glycémie et résumé</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <Pressable style={styles.cgmLink} onPress={() => router.push("/ajouter-poids")} testID="weight-settings-link">
          <View style={[styles.cgmLinkIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="scale-outline" size={18} color={colors.onBrandTertiary} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text style={styles.cgmLinkTitle}>Suivi du poids</Text>
            <Text style={styles.cgmLinkSubtitle}>Historique des pesées et tendance</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <Button title="Enregistrer" onPress={handleSave} disabled={save.isPending} testID="profile-save-button" />

        <Pressable
          style={styles.logoutButton}
          onPress={() => signOut()}
          testID="logout-button"
          accessibilityRole="button"
        >
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.cgmLink, { marginTop: 16 }, pressed && { opacity: 0.8 }]}
          onPress={() => router.push("/supprimer-compte")}
          testID="delete-account-settings-link"
          accessibilityRole="button"
        >
          <View style={[styles.cgmLinkIcon, { backgroundColor: `${colors.error}12` }]}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </View>
          <View style={styles.cgmLinkMain}>
            <Text testID="delete-account-settings-title" style={[styles.cgmLinkTitle, { color: colors.error }]}>Supprimer mon compte</Text>
            <Text testID="delete-account-settings-description" style={styles.cgmLinkSubtitle}>Effacer définitivement mon compte et mes données</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </ScrollView>
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
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 12,
  },
  unitHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
  },
  unitToggleContainer: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  unitButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 6,
  },
  unitButtonActive: {
    backgroundColor: colors.brandPrimary || "#007AFF",
  },
  unitButtonText: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  unitButtonTextActive: {
    color: "#fff",
  },
  rowFields: {
    flexDirection: "row",
    gap: 10,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 16,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  accountAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  accountAvatarText: {
    color: colors.onBrandTertiary,
    fontSize: 18,
    fontWeight: "500",
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
  },
  accountEmail: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    height: 48,
  },
  logoutText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: "500",
  },
  cgmLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  cgmLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  cgmLinkMain: {
    flex: 1,
  },
  cgmLinkTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
  },
  cgmLinkSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
}));