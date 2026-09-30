import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Svg, { Path, Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/src/theme";

interface Point {
  value: number | null;
  at: string;
}

interface Marker {
  start: string;
  end: string;
  label: string;
}

interface MealMarker {
  at: string;
  carbs?: number;
}

interface GlucoseChartProps {
  points: Point[];
  targets: { low: number; high: number };
  unit?: string;
  markers?: Marker[];
  meals?: MealMarker[];
}

const CHART_HEIGHT = 250;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 45;
const PADDING_LEFT = 35;
const PADDING_RIGHT = 20;

function formatXLabel(timestamp: number, totalSpanMs: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");

  if (totalSpanMs <= 24 * 60 * 60 * 1000) {
    return `${hours}:${mins}`;
  } else if (totalSpanMs <= 7 * 24 * 60 * 60 * 1000) {
    return `${day}/${month} ${hours}h`;
  }
  return `${day}/${month}`;
}

export function GlucoseChart({
  points,
  targets,
  unit = "mg/dL",
  markers = [],
  meals = [],
}: GlucoseChartProps) {
  const { colors } = useTheme();
  const width = Dimensions.get("window").width - 64;

  if (!points || points.length === 0) return null;

  const times = points.map((p) => new Date(p.at).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = maxTime - minTime || 1;

  const validValues = points.map((p) => p.value).filter((v): v is number => v !== null);
  const minVal = 40;
  const maxVal = Math.max(250, ...validValues, targets.high + 20);

  const scaleX = (timeStr: string | number) => {
    const t = typeof timeStr === "number" ? timeStr : new Date(timeStr).getTime();
    return PADDING_LEFT + ((t - minTime) / timeSpan) * (width - PADDING_LEFT - PADDING_RIGHT);
  };

  const scaleY = (val: number) => {
    const usableHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
    return PADDING_TOP + usableHeight - ((val - minVal) / (maxVal - minVal)) * usableHeight;
  };

  const TICK_COUNT = 4;
  const xTicks = Array.from({ length: TICK_COUNT }, (_, i) => minTime + (i / (TICK_COUNT - 1)) * timeSpan);

  let pathD = "";
  let lastWasNull = true;

  points.forEach((p) => {
    if (p.value === null || p.value === undefined) {
      lastWasNull = true;
      return;
    }
    const x = scaleX(p.at);
    const y = scaleY(p.value);

    if (lastWasNull) {
      pathD += `M ${x} ${y} `;
      lastWasNull = false;
    } else {
      pathD += `L ${x} ${y} `;
    }
  });

  const yTargetLow = scaleY(targets.low);
  const yTargetHigh = scaleY(targets.high);
  const yAxisBase = CHART_HEIGHT - PADDING_BOTTOM;

  return (
    <View style={styles.container}>
      <Svg width={width} height={CHART_HEIGHT}>
        {/* Plage cible */}
        <Rect
          x={PADDING_LEFT}
          y={yTargetHigh}
          width={width - PADDING_LEFT - PADDING_RIGHT}
          height={yTargetLow - yTargetHigh}
          fill={colors.success}
          fillOpacity={0.08}
        />

        {/* Axe X / Grille */}
        {xTicks.map((tickTime, idx) => {
          const x = scaleX(tickTime);
          return (
            <React.Fragment key={idx}>
              <Line
                x1={x}
                y1={PADDING_TOP}
                x2={x}
                y2={yAxisBase}
                stroke={colors.surfaceTertiary ?? "#E0E0E0"}
                strokeDasharray="2 2"
                strokeWidth={1}
              />
              <SvgText
                x={x}
                y={CHART_HEIGHT - 8}
                fontSize={10}
                fill={colors.onSurfaceSecondary}
                textAnchor="middle"
              >
                {formatXLabel(tickTime, timeSpan)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Lignes limites de cible */}
        <Line x1={PADDING_LEFT} y1={yTargetLow} x2={width - PADDING_RIGHT} y2={yTargetLow} stroke={colors.success} strokeDasharray="4 4" strokeWidth={1} />
        <Line x1={PADDING_LEFT} y1={yTargetHigh} x2={width - PADDING_RIGHT} y2={yTargetHigh} stroke={colors.warning} strokeDasharray="4 4" strokeWidth={1} />

        {/* Activités physiques */}
        {markers.map((m, idx) => {
          const xStart = scaleX(m.start);
          const xEnd = scaleX(m.end);
          return (
            <Rect
              key={`m-${idx}`}
              x={xStart}
              y={PADDING_TOP}
              width={Math.max(xEnd - xStart, 4)}
              height={yAxisBase - PADDING_TOP}
              fill={colors.info}
              fillOpacity={0.25}
              rx={2}
            />
          );
        })}

        {/* Marqueurs de Repas (Lignes verticales d'impact + marqueur) */}
        {meals.map((meal, idx) => {
          const xMeal = scaleX(meal.at);
          if (xMeal < PADDING_LEFT || xMeal > width - PADDING_RIGHT) return null;
          return (
            <React.Fragment key={`meal-${idx}`}>
              <Line
                x1={xMeal}
                y1={PADDING_TOP}
                x2={xMeal}
                y2={yAxisBase}
                stroke={colors.brandPrimary}
                strokeDasharray="3 3"
                strokeWidth={1.2}
                opacity={0.6}
              />
              <SvgText
                x={xMeal}
                y={PADDING_TOP - 4}
                fontSize={11}
                textAnchor="middle"
              >
                🍽️
              </SvgText>
              {meal.carbs ? (
                <SvgText
                  x={xMeal}
                  y={yAxisBase - 4}
                  fontSize={9}
                  fill={colors.brandPrimary}
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {meal.carbs}g
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}

        {/* Courbe */}
        {pathD ? <Path d={pathD} stroke={colors.brandPrimary} strokeWidth={2} fill="none" /> : null}

        {/* Points de glycémie */}
        {points.map((p, idx) => {
          if (p.value === null) return null;
          const x = scaleX(p.at);
          const y = scaleY(p.value);
          const color = p.value < targets.low ? colors.error : p.value > targets.high ? colors.warning : colors.success;
          return <Circle key={idx} cx={x} cy={y} r={3.5} fill={color} />;
        })}
      </Svg>

      <View style={[styles.yAxisLabel, { top: yTargetHigh - 8 }]}>
        <Text style={[styles.axisText, { color: colors.warning }]}>{targets.high}</Text>
      </View>
      <View style={[styles.yAxisLabel, { top: yTargetLow - 8 }]}>
        <Text style={[styles.axisText, { color: colors.success }]}>{targets.low}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  yAxisLabel: {
    position: "absolute",
    left: 4,
  },
  axisText: {
    fontSize: 10,
    fontWeight: "600",
  },
});