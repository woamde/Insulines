import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { round1 } from "@/src/glucose";
import { useFoods } from "@/src/api";
import type { Food, MealItem } from "@/src/types";
import { TextField } from "@/src/components/ui";

// Éditeur d'aliments : recherche dans la base française + portions éditables.
export function FoodSearch({
  items,
  onItemsChange,
}: {
  items: MealItem[];
  onItemsChange: (items: MealItem[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { data: foods, isLoading } = useFoods();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const results: Food[] = (foods ?? [])
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .slice(0, 8);

  const addFood = (f: Food) => {
    const grams = f.portion_g;
    onItemsChange([
      ...items,
      {
        name: f.name,
        grams,
        carbs_per_100g: f.carbs_per_100g,
        carbs_g: round1((f.carbs_per_100g * grams) / 100),
      },
    ]);
    setQuery("");
  };

  const remove = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  return (
    <View>
      <TextField
        label="Rechercher un aliment"
        value={query}
        onChangeText={setQuery}
        placeholder="Ex : riz, banane, pizza…"
        testID="food-search-input"
      />
      {q !== "" && results.length > 0 ? (
        <View style={styles.results}>
          <FlatList
            data={results}
            keyExtractor={(f) => f.id}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.7 }]}
                onPress={() => addFood(item)}
                testID={`food-result-${item.id}`}
              >
                <View style={styles.resultIcon}>
                  <Ionicons name="add" size={16} color={colors.onBrandTertiary} />
                </View>
                <Text style={styles.resultName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.resultMeta}>
                  {item.carbs_per_100g} g/100 g · {item.portion_g} g
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      {items.length > 0 ? (
        <View style={styles.selected}>
          {items.map((it, i) => (
            <View key={`${it.name}-${i}`} style={styles.selectedRow}>
              <View style={styles.selectedInfo}>
                <Text style={styles.selectedName} numberOfLines={1}>
                  {it.name}
                </Text>
                <Text style={styles.selectedMeta}>{round1(it.carbs_g)} g de glucides</Text>
              </View>
              <View style={styles.gramsBox}>
                <Text style={styles.gramsLabel}>Portion</Text>
                <Text style={styles.gramsInput}>{Math.round(it.grams)} g</Text>
              </View>
              <Pressable
                onPress={() => remove(i)}
                testID={`food-remove-${i}`}
                style={styles.removeBtn}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : isLoading ? null : (
        <Text style={styles.hint}>
          Ajoutez des aliments pour estimer automatiquement les glucides.
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  results: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginTop: 4,
    overflow: "hidden",
  },
  separator: {
    height: 1,
    backgroundColor: colors.divider,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 48,
  },
  resultIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  resultName: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  resultMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  selected: {
    marginTop: 10,
    gap: 8,
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    padding: 10,
  },
  selectedInfo: {
    flex: 1,
  },
  selectedName: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  selectedMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  gramsBox: {
    alignItems: "flex-end",
  },
  gramsLabel: {
    color: colors.muted,
    fontSize: 10,
  },
  gramsInput: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  removeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 6,
  },
}));
