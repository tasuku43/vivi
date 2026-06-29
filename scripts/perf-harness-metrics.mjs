export function summarizeProcessSamples(samples, label) {
  const rss = samples.map((sample) => sample.rssBytes).filter(Number.isFinite);
  const cpu = samples.map((sample) => sample.cpuPercent).filter(Number.isFinite);
  const cpuTime = samples.map((sample) => sample.cpuTimeMs).filter(Number.isFinite);
  const wallMs = samples.length >= 2 ? samples.at(-1).atMs - samples[0].atMs : null;
  const cpuDeltaMs = cpuTime.length ? cpuTime.at(-1) - cpuTime[0] : null;
  return {
    label,
    sampleCount: samples.length,
    rssBytes: numericSummary(rss),
    cpuPercent: numericSummary(cpu),
    cpuTimeMs: cpuTime.length ? { first: cpuTime[0], last: cpuTime.at(-1), delta: cpuDeltaMs } : null,
    windowMs: wallMs,
    cpuPercentByTime:
      wallMs && wallMs > 0 && Number.isFinite(cpuDeltaMs)
        ? round((Math.max(0, cpuDeltaMs) / wallMs) * 100, 3)
        : null,
  };
}

export function summarizeProcessSamplesSince(samples, label, sinceMs) {
  return summarizeProcessSamples(
    samples.filter((sample) => sample.atMs >= sinceMs),
    label,
  );
}

export function summarizeProcessTreeSamples(samples, label) {
  const totals = samples.map((sample) => ({
    atMs: sample.atMs,
    rssBytes: sample.rssBytes,
    cpuPercent: sample.cpuPercent,
    cpuTimeMs: sample.cpuTimeMs,
  }));
  const roles = {};
  const roleNames = Array.from(new Set(samples.flatMap((sample) => Object.keys(sample.roles ?? {})))).sort();
  for (const roleName of roleNames) {
    const roleSamples = samples.map((sample) => {
      const role = sample.roles?.[roleName] ?? {};
      return {
        atMs: sample.atMs,
        rssBytes: role.rssBytes ?? 0,
        cpuPercent: role.cpuPercent ?? 0,
        cpuTimeMs: role.cpuTimeMs ?? 0,
      };
    });
    roles[roleName] = {
      ...summarizeProcessSamples(roleSamples, `${label}_${roleName}`),
      processCount: numericSummary(samples.map((sample) => sample.roles?.[roleName]?.processCount ?? 0)),
    };
  }
  return {
    ...summarizeProcessSamples(totals, label),
    processCount: numericSummary(samples.map((sample) => sample.processCount).filter(Number.isFinite)),
    roles,
  };
}

export function summarizeProcessTreeSamplesSince(samples, label, sinceMs) {
  return summarizeProcessTreeSamples(
    samples.filter((sample) => sample.atMs >= sinceMs),
    label,
  );
}

export function aggregateProcessSummaries(summaries) {
  return {
    sampleCount: summaries.reduce((sum, summary) => sum + summary.sampleCount, 0),
    rssBytes: numericSummary(summaries.map((summary) => summary.rssBytes?.max).filter(Number.isFinite)),
    cpuPercent: numericSummary(summaries.map((summary) => summary.cpuPercent?.max).filter(Number.isFinite)),
    cpuTimeMs: numericSummary(summaries.map((summary) => summary.cpuTimeMs?.delta).filter(Number.isFinite)),
  };
}

export function numericSummary(values) {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, avg: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: round(sum / values.length, 3),
  };
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
