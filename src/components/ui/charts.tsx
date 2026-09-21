"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = {
  stroke: "transparent",
  tick: { fill: "#6B7079", fontSize: 10, fontFamily: "var(--font-mono)" },
  tickLine: false,
  axisLine: false,
} as const;

const GRID = { stroke: "rgba(255,255,255,0.05)", strokeDasharray: "2 4" } as const;

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
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-ghost">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-[10px] text-ink-faint">{p.name}</span>
          <span className="num ml-auto text-[11px] font-medium text-ink">
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
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#31D0A0" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#31D0A0" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6C7CFF" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#6C7CFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="day" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...AXIS} width={38} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
        <Area
          type="monotone"
          dataKey="created"
          name="Created"
          stroke="#6C7CFF"
          strokeWidth={1.5}
          fill="url(#gCreated)"
        />
        <Area
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke="#31D0A0"
          strokeWidth={1.75}
          fill="url(#gCompleted)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DepartmentBars({
  data,
  height = 200,
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis {...AXIS} width={38} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="value" name="Tasks" radius={[3, 3, 0, 0]} maxBarSize={34}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} fillOpacity={0.85} />
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
            <stop offset="0%" stopColor="#6C7CFF" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#6C7CFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis
          {...AXIS}
          width={46}
          tickFormatter={(v: number) => `${Math.round(v / 100000) / 10}M`}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => `¥${Number(v).toLocaleString("en-US")}`} />}
          cursor={{ stroke: "rgba(255,255,255,0.12)" }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="#6C7CFF"
          strokeWidth={1.75}
          fill="url(#gRevenue)"
        />
        <Line type="monotone" dataKey="cost" name="Cost" stroke="#E5A84B" strokeWidth={1.5} dot={false} />
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
      <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="day" {...AXIS} />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
        <Line
          type="monotone"
          dataKey="tokens"
          name="Tokens"
          stroke="#5BC8D8"
          strokeWidth={1.75}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({
  data,
  color = "#6C7CFF",
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
