"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Chart chrome.
 *
 * Axes and grid stay recessive but legible — the old tick colour (#6B7079)
 * sat at 3.9:1 and was effectively unreadable. Ticks now use the ink-faint
 * step (5.8:1) and the grid is just visible enough to guide the eye.
 */
const AXIS = {
  stroke: "transparent",
  tick: { fill: "#868D98", fontSize: 11, fontFamily: "var(--font-mono)" },
  tickLine: false,
  axisLine: false,
} as const;

const GRID = { stroke: "rgba(255,255,255,0.08)", strokeDasharray: "2 4" } as const;

/** Series colours, taken from the validated categorical palette. */
const SERIES = {
  completed: "#34D399", // status green — "done" is a state, not an identity
  created: "#3987e5", // categorical blue
  revenue: "#3987e5",
  cost: "#d95926", // categorical orange — clearly opposed to revenue
  tokens: "#60A5FA",
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
  formatter?: (v: number | string, name?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-hairline-strong bg-surface-overlay/95 px-2.5 py-2 shadow-lift backdrop-blur-xl">
      <div className="font-mono text-3xs uppercase tracking-[0.14em] text-ink-ghost">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="text-2xs text-ink-muted">{p.name}</span>
          <span className="num ml-auto text-2xs font-semibold text-ink">
            {formatter && p.value !== undefined
              ? formatter(p.value, p.name)
              : typeof p.value === "number"
                ? p.value.toLocaleString("en-US")
                : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ThroughputChart({
  data,
  height = 180,
}: {
  data: { day: string; completed: number; created: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 6, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.completed} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SERIES.completed} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.created} stopOpacity={0.22} />
            <stop offset="100%" stopColor={SERIES.created} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="day" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...AXIS} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.18)" }} />
        <Area
          type="monotone"
          dataKey="created"
          name="Created"
          stroke={SERIES.created}
          strokeWidth={2}
          fill="url(#gCreated)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0D0E10" }}
        />
        <Area
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke={SERIES.completed}
          strokeWidth={2}
          fill="url(#gCompleted)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0D0E10" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DepartmentBars({
  data,
  height = 200,
  layout = "horizontal",
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
  /** "vertical" lays the bars along the y-axis so full names fit. */
  layout?: "horizontal" | "vertical";
}) {
  if (layout === "vertical") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
          barCategoryGap="24%"
        >
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} />
          <YAxis
            type="category"
            dataKey="label"
            {...AXIS}
            width={96}
            tick={{ ...AXIS.tick, textAnchor: "start" }}
            tickMargin={92}
            interval={0}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="value" name="Tasks" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              offset={8}
              style={{ fill: "#A8AEB8", fontSize: 11, fontFamily: "var(--font-mono)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis {...AXIS} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="value" name="Tasks" radius={[4, 4, 0, 0]} maxBarSize={30}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart({
  data,
  height = 200,
}: {
  data: { month: string; revenue: number; cost: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.revenue} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SERIES.revenue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis
          {...AXIS}
          width={52}
          tickFormatter={(v: number) => `${Math.round(v / 100000) / 10}M`}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => `¥${Number(v).toLocaleString("en-US")}`} />}
          cursor={{ stroke: "rgba(255,255,255,0.18)" }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke={SERIES.revenue}
          strokeWidth={2}
          fill="url(#gRevenue)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0D0E10" }}
        />
        <Line
          type="monotone"
          dataKey="cost"
          name="Cost"
          stroke={SERIES.cost}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0D0E10" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function UsageChart({
  data,
  height = 180,
}: {
  data: { day: string; tokens: number; calls: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="day" {...AXIS} />
        <YAxis {...AXIS} width={56} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.18)" }} />
        <Line
          type="monotone"
          dataKey="tokens"
          name="Tokens"
          stroke={SERIES.tokens}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0D0E10" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Identity for multi-series charts — never leave two series unlabelled. */
export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className ?? ""}`}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-3 rounded-[2px]"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          <span className="font-mono text-3xs uppercase tracking-[0.12em] text-ink-faint">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export const CHART_SERIES = SERIES;

export function Sparkline({
  data,
  color = SERIES.created,
  height = 34,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const series = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.25}
          fill={`url(#spark-${color.replace("#", "")})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
