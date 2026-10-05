import { useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { shareUrl, useCreateShareLink, useRevokeShareLink, useShareLinks, useUpdateShareLink } from "@/src/api";
import { formatDayLabel, formatTime } from "@/src/glucose";
import { Card, EmptyState, LoadingState, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import type { ShareLink } from "@/src/types";

export default function Partage() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const links = useShareLinks();
  const create = useCreateShareLink();
  const revoke = useRevokeShareLink();
  const update = useUpdateShareLink();
  const [label, setLabel] = useState("");
  const [alertEmail, setAlertEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");

  const sendLink = async (link: ShareLink) => {
    const url = shareUrl(link.token);
    const message = `Voici mon suivi de glycémie en temps réel (lecture seule) : ${url}`;
    try {
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(url);
        toast.show("Lien copié dans le presse-papiers", "success");
        return;
      }
      await Share.share({ message, url }, { dialogTitle: `Partager avec ${link.label}` });
    } catch {
      await Clipboard.setStringAsync(url);
      toast.show("Lien copié dans le presse-papiers", "success");
    }
  };

  const copyLink = async (link: ShareLink) => {
    await Clipboard.setStringAsync(shareUrl(link.token));
    toast.show("Lien copié", "success");
  };

  const handleCreate = () => {
    create.mutate(
      { label: label.trim(), alert_email: alertEmail.trim() },
      {
        onSuccess: (link) => {
          setLabel("");
          setAlertEmail("");
          toast.show(`Lien créé pour ${link.label}`, "success");
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  const saveAlert = (id: string) => {
    update.mutate(
      { id, alert_email: editEmail.trim() },
      {
        onSuccess: (r) => {
          setEditingId(null);
          toast.show(r.alert_email ? "Alerte hypo activée" : "Alerte hypo désactivée", "success");
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} testID="share-back-button" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Partage avec un proche</Text>
      </View>

      <View style={{ flex: 1, padding: 16 }}>
        <Card style={styles.infoCard}>
          <Ionicons name="people" size={20} color={colors.onBrandTertiary} />
          <Text style={styles.infoText}>
            Un proche ouvre le lien dans son navigateur et voit, en lecture seule, votre dernière glycémie, votre courbe des 24 h et le
            résumé du jour. Aucune connexion nécessaire pour lui ; vous pouvez révoquer le lien à tout moment.
          </Text>
        </Card>

        <Card testID="share-create-card">
          <TextField label="Nouveau lien pour…" value={label} onChangeText={setLabel} placeholder="Ex : Maman, Conjoint, Infirmière" testID="share-label-input" />
          <TextField
            label="E-mail pour les alertes hypo (optionnel)"
            value={alertEmail}
            onChangeText={setAlertEmail}
            placeholder="proche@exemple.fr"
            keyboardType="email"
            testID="share-alert-email-input"
            hint="Ce proche recevra un e-mail si une glycémie passe sous votre cible basse (au plus une alerte par heure)."
          />
          <PrimaryButton label="Créer le lien de partage" onPress={handleCreate} loading={create.isPending} testID="share-create-button" icon={<Ionicons name="link" size={18} color={colors.onBrandPrimary} />} />
        </Card>

        {links.isLoading ? (
          <LoadingState label="Chargement…" />
        ) : !links.data || links.data.length === 0 ? (
          <EmptyState icon={<Ionicons name="people-outline" size={36} color={colors.brandPrimary} />} title="Aucun lien actif" message="Créez un lien pour un proche de confiance." />
        ) : (
          <Card testID="share-links-card">
            <Text style={styles.cardTitle}>Liens actifs</Text>
            {links.data.map((link, idx) => (
              <View key={link.id} style={[styles.row, idx > 0 && styles.rowBorder]} testID={`share-row-${link.id}`}>
                <View style={styles.rowIcon}>
                  <Ionicons name="person" size={16} color={colors.onBrandTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{link.label}</Text>
                  <Text style={styles.rowMeta}>
                    {link.last_viewed_at
                      ? `Vu ${link.views} fois · dernière fois ${formatDayLabel(link.last_viewed_at).toLowerCase()} à ${formatTime(link.last_viewed_at)}`
                      : `Créé ${formatDayLabel(link.created_at).toLowerCase()} · jamais ouvert`}
                  </Text>
                  {editingId === link.id ? (
                    <View style={styles.alertEdit}>
                      <TextField value={editEmail} onChangeText={setEditEmail} placeholder="proche@exemple.fr" keyboardType="email" testID={`share-alert-input-${link.id}`} />
                      <View style={styles.alertEditButtons}>
                        <Pressable onPress={() => saveAlert(link.id)} style={styles.smallButton} testID={`share-alert-save-${link.id}`} accessibilityRole="button">
                          <Text style={styles.smallButtonText}>Enregistrer</Text>
                        </Pressable>
                        <Pressable onPress={() => setEditingId(null)} style={styles.smallButton} accessibilityRole="button">
                          <Text style={[styles.smallButtonText, { color: colors.muted }]}>Annuler</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setEditingId(link.id);
                        setEditEmail(link.alert_email ?? "");
                      }}
                      style={styles.alertRow}
                      testID={`share-alert-toggle-${link.id}`}
                      accessibilityRole="button"
                    >
                      <Ionicons name={link.alert_email ? "notifications" : "notifications-off-outline"} size={14} color={link.alert_email ? colors.warning : colors.muted} />
                      <Text style={[styles.alertText, { color: link.alert_email ? colors.warning : colors.muted }]} numberOfLines={1}>
                        {link.alert_email ? `Alerte hypo → ${link.alert_email}${link.alerts_sent ? ` (${link.alerts_sent} envoyée${link.alerts_sent > 1 ? "s" : ""})` : ""}` : "Ajouter une alerte hypo par e-mail"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Pressable onPress={() => copyLink(link)} style={styles.iconButton} hitSlop={6} testID={`share-copy-${link.id}`} accessibilityRole="button">
                  <Ionicons name="copy-outline" size={18} color={colors.brandPrimary} />
                </Pressable>
                <Pressable onPress={() => sendLink(link)} style={styles.iconButton} hitSlop={6} testID={`share-send-${link.id}`} accessibilityRole="button">
                  <Ionicons name="share-social-outline" size={18} color={colors.brandPrimary} />
                </Pressable>
                <Pressable
                  onPress={() => revoke.mutate(link.id, { onSuccess: () => toast.show("Lien révoqué", "success"), onError: (e) => toast.show(e.message, "error") })}
                  style={styles.iconButton}
                  hitSlop={6}
                  testID={`share-revoke-${link.id}`}
                  accessibilityRole="button"
                >
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </View>
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
  infoCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brandTertiary,
  },
  infoText: {
    flex: 1,
    color: colors.onBrandTertiary,
    fontSize: 13,
    lineHeight: 18,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    minHeight: 24,
  },
  alertText: {
    fontSize: 11,
    fontWeight: "500",
    flex: 1,
  },
  alertEdit: {
    marginTop: 6,
  },
  alertEditButtons: {
    flexDirection: "row",
    gap: 12,
  },
  smallButton: {
    minHeight: 32,
    justifyContent: "center",
  },
  smallButtonText: {
    color: colors.brandPrimary,
    fontSize: 13,
    fontWeight: "500",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
}));
