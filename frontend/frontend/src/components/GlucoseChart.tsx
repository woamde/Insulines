import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { makeStyles, useTheme } from "@/src/theme";
import { DEFAULT_TARGETS, formatTime, glucoseZone, type Targets, zoneColor } from "@/src/glucose";
import { unitsFor, type GlucoseUnit } from "@/src/units";

interface Point {
  value: number;
  at: string;
}

export interface ChartMarker {
  start: string;
  end: string;
  label: string;
}

const HEIGHT = 200;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;

export function GlucoseChart({
  points,
  targets = DEFAULT_TARGETS,
  unit = "mgdl",
  markers = [],
}: {
  points: Point[];
  targets?: Targets;
  unit?: GlucoseUnit;
  markers?: ChartMarker[];
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const units = unitsFor(unit);

  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    setWidth(e.nativeEvent.layout.width);
  };

  if (points.length === 0 || width === 0) {
    return <View style={styles.container} onLayout={onLayout} testID="glucose-chart-empty" />;
  }

  const values = points.map((p) => p.value);
  const min = Math.max(30, Math.min(60, ...values) - 15);
  const max = Math.max(200, ...values) + 20;
  const n = points.length;
  const times = points.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = Math.max(1, t1 - t0);
  const plotW = width - PAD_LEFT - PAD_RIGHT;

  const xAt = (t: number) => PAD_LEFT + (n === 1 ? plotW / 2 : ((t - t0) / span) * plotW);
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const linePoints = points.map((p, i) => `${xAt(times[i])},${y(p.value)}`).join(" ");
  const bandTop = y(targets.high);
  const bandBottom = y(targets.low);
  const labelIdx = Array.from(new Set(n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1]));

  const visibleMarkers = markers
    .map((m) => {
      const s = new Date(m.start).getTime();
      const e = new Date(m.end).getTime();
      if (Number.isNaN(s) || Number.isNaN(e) || e < t0 || s > t1) return null;
      const xs = xAt(Math.max(s, t0));
      const xe = xAt(Math.min(e, t1));
      return { xs, xe: Math.max(xe, xs + 3), label: m.label };
    })
    .filter((m): m is { xs: number; xe: number; label: string } => m !== null);

  return (
    <View style={styles.container} onLayout={onLayout} testID="glucose-chart">
      <Svg width={width} height={HEIGHT}>
        <Rect x={PAD_LEFT} y={bandTop} width={plotW} height={Math.max(0, bandBottom - bandTop)} fill={colors.success} opacity={0.07} rx={8} />
        {visibleMarkers.map((m, i) => (
          <Rect key={`m-${i}`} x={m.xs} y={PAD_TOP} width={m.xe - m.xs} height={HEIGHT - PAD_TOP - PAD_BOTTOM} fill={colors.info} opacity={0.14} rx={3} />
        ))}
        {visibleMarkers.map((m, i) => (
          <SvgText key={`ml-${i}`} x={(m.xs + m.xe) / 2} y={PAD_TOP - 3} fontSize={9} fill={colors.info} textAnchor="middle">
            {m.label}
          </SvgText>
        ))}
        {[targets.low, targets.high].map((v) => (
          <Line key={v} x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y(v)} y2={y(v)} stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="4 4" />
        ))}
        {[targets.low, targets.high].map((v) => (
          <SvgText key={`yl-${v}`} x={PAD_LEFT - 4} y={y(v) + 3} fontSize={9} fill={colors.muted} textAnchor="end">
            {units.fmt(v)}
          </SvgText>
        ))}
        {n > 1 ? (
          <Polyline points={linePoints} fill="none" stroke={colors.brandPrimary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {points.map((p, i) => (
          <Circle key={i} cx={xAt(times[i])} cy={y(p.value)} r={n > 40 ? 2 : 3.5} fill={zoneColor(glucoseZone(p.value, targets), colors)} />
        ))}
        {labelIdx.map((i) => (
          <SvgText
            key={`xl-${i}`}
            x={xAt(times[i])}
            y={HEIGHT - 6}
            fontSize={10}
            fill={colors.muted}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {formatTime(points[i].at)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  container: {
    width: "100%",
    height: HEIGHT,
  },
}));
