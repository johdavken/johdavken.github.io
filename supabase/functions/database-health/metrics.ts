export type DatabaseHealth = {
  cpuPercent: number | null;
  connections: number | null;
  memoryPercent: number | null;
};
export type CpuSnapshot = { total: number; idle: number };

type Sample = { name: string; labels: Record<string, string>; value: number };

// Prometheus exposition parsing deliberately accepts only ordinary numeric samples.
// HELP/TYPE comments, histograms and malformed lines cannot escape this module.
export function parsePrometheus(text: string): Sample[] | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const samples: Sample[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    // Prometheus permits NaN and +/-Inf sample values. Supabase currently
    // emits NaN for a few unavailable Postgres statistics, so recognize and
    // skip those individual samples instead of rejecting the useful payload.
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(NaN|[+-]?Inf|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+\d+)?\s*$/);
    if (!match) return null;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    if (match[2]) {
      for (const item of match[2].matchAll(/(?:^|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g)) labels[item[1]] = item[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    samples.push({ name: match[1], labels, value });
  }
  return samples.length ? samples : null;
}

export function cpuSnapshot(text: string): CpuSnapshot | null {
  const samples = parsePrometheus(text);
  if (!samples) return null;
  const cpu = samples.filter(item => item.name === "node_cpu_seconds_total");
  const total = cpu.reduce((sum, item) => sum + item.value, 0);
  const idle = cpu.filter(item => item.labels.mode === "idle" || item.labels.mode === "iowait").reduce((sum, item) => sum + item.value, 0);
  return total > 0 ? { total, idle } : null;
}

export function extractDatabaseHealth(text: string, previousCpu: CpuSnapshot | null): DatabaseHealth | null {
  const samples = parsePrometheus(text);
  if (!samples) return null;

  // Supabase's published payload includes node_cpu_seconds_total by CPU and
  // mode. CPU is 100 × (1 - delta(idle + iowait) / delta(all modes)) across
  // two one-minute scrapes. Summing labels first prevents a multi-CPU series
  // from being mistaken for a percentage.
  const currentCpu = cpuSnapshot(text);
  const totalDelta = currentCpu && previousCpu ? currentCpu.total - previousCpu.total : 0;
  const idleDelta = currentCpu && previousCpu ? currentCpu.idle - previousCpu.idle : 0;
  const cpuPercent = totalDelta > 0 && idleDelta >= 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta))) : null;
  const totalMemory = samples.find(item => item.name === "node_memory_MemTotal_bytes")?.value;
  const availableMemory = samples.find(item => item.name === "node_memory_MemAvailable_bytes")?.value;
  const memoryPercent = totalMemory && availableMemory != null && availableMemory >= 0 ? 100 * (1 - availableMemory / totalMemory) : null;
  const connection = samples.find(item => item.name === "pgbouncer_databases_current_connections");
  const connections = connection && Number.isInteger(connection.value) && connection.value >= 0 ? connection.value : null;
  return { cpuPercent, connections, memoryPercent };
}
