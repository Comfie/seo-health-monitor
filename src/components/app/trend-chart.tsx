"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  /** Emphasised series (e.g. the overall score) is drawn thicker. */
  strong?: boolean;
}

/**
 * Value formats by name. Functions can't be passed from Server Components to
 * this Client Component, so callers choose a named format instead.
 */
export type ValueFormat = "integer" | "decimal1" | "percent";

const FORMATTERS: Record<ValueFormat, (v: number) => string> = {
  integer: (v) => Math.round(v).toLocaleString("en-GB"),
  decimal1: (v) => v.toFixed(1),
  percent: (v) => `${(v * 100).toFixed(1)}%`,
};

/**
 * One-axis line chart with a crosshair tooltip. Two measures with different
 * scales must be separate charts (never a dual axis).
 */
export function TrendChart({
  data,
  series,
  height = 240,
  yDomain,
  valueFormat = "integer",
  reversed = false,
  ariaLabel,
}: {
  data: Record<string, string | number | null>[];
  series: TrendSeries[];
  height?: number;
  yDomain?: [number | "auto", number | "auto"];
  valueFormat?: ValueFormat;
  /** For metrics where lower is better and rank 1 sits at the top (average position). */
  reversed?: boolean;
  ariaLabel: string;
}) {
  const format = FORMATTERS[valueFormat];
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
          <YAxis domain={yDomain ?? ["auto", "auto"]} reversed={reversed} tickFormatter={(v: number) => format(v)} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={52} allowDecimals={valueFormat !== "integer"} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, color: "var(--foreground)" }}
            formatter={(value, name) => [typeof value === "number" ? format(value) : "—", name]}
          />
          {series.length > 1 && <Legend iconType="plainline" itemSorter={null} wrapperStyle={{ fontSize: 13 }} formatter={(value) => <span style={{ color: "var(--foreground)" }}>{value}</span>} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={s.strong ? 3 : 2}
              dot={data.length <= 12 ? { r: 4, strokeWidth: 2, stroke: "var(--card)", fill: s.color } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
