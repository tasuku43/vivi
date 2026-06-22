import { existsSync, readFileSync } from "node:fs";

export function readOtelSpans(file) {
  if (!existsSync(file)) return [];
  const spans = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const record = JSON.parse(line);
    for (const span of spansFromRecord(record)) {
      spans.push(span);
    }
  }
  return spans;
}

export function summarizeOperationSpans(spans, durationMs) {
  const groups = {};
  for (const span of spans) {
    const attributes = attributesMap(span.attributes ?? []);
    const operation = attributes["vivi.operation"];
    if (!operation) continue;
    const group = groups[operation] ?? {
      count: 0,
      frequencyPerSecond: 0,
      durationMs: statsBucket(),
      scannedDirectories: statsBucket(),
      scannedFiles: statsBucket(),
      readFiles: statsBucket(),
      emittedEvents: statsBucket(),
      resultCount: statsBucket(),
      cached: 0,
      errors: 0,
    };
    group.count++;
    group.durationMs = addStat(group.durationMs, numberValue(attributes.duration_ms));
    group.scannedDirectories = addStat(group.scannedDirectories, numberValue(attributes.scanned_directories));
    group.scannedFiles = addStat(group.scannedFiles, numberValue(attributes.scanned_files));
    group.readFiles = addStat(group.readFiles, numberValue(attributes.read_files));
    group.emittedEvents = addStat(group.emittedEvents, numberValue(attributes.emitted_events));
    group.resultCount = addStat(group.resultCount, numberValue(attributes.result_count));
    if (attributes.cached === true) {
      group.cached++;
    }
    if (attributes.error === true) {
      group.errors++;
    }
    groups[operation] = group;
  }
  for (const group of Object.values(groups)) {
    group.frequencyPerSecond = durationMs > 0 ? round(group.count / (durationMs / 1000), 3) : 0;
    for (const key of ["durationMs", "scannedDirectories", "scannedFiles", "readFiles", "emittedEvents", "resultCount"]) {
      group[key] = finalizeStat(group[key]);
    }
  }
  return {
    spanCount: spans.length,
    operations: groups,
  };
}

function spansFromRecord(record) {
  const spans = [];
  for (const resourceSpan of record.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? resourceSpan.instrumentationLibrarySpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        spans.push(span);
      }
    }
  }
  return spans;
}

function attributesMap(attributes) {
  const result = {};
  for (const attribute of attributes) {
    result[attribute.key] = attributeValue(attribute.value ?? {});
  }
  return result;
}

function attributeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("boolValue" in value) return Boolean(value.boolValue);
  return undefined;
}

function statsBucket() {
  return { count: 0, min: null, max: null, sum: 0 };
}

function addStat(bucket, value) {
  if (!Number.isFinite(value)) return bucket;
  bucket.count++;
  bucket.min = bucket.min === null ? value : Math.min(bucket.min, value);
  bucket.max = bucket.max === null ? value : Math.max(bucket.max, value);
  bucket.sum += value;
  return bucket;
}

function finalizeStat(bucket) {
  return {
    count: bucket.count,
    min: bucket.min,
    max: bucket.max,
    sum: bucket.sum,
    avg: bucket.count > 0 ? round(bucket.sum / bucket.count, 3) : null,
  };
}

function numberValue(value) {
  return typeof value === "number" ? value : Number(value);
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
