/**
 * Performance benchmark for the n-gram search index.
 * Measures index build time and query latency at 1x, 10x, and 100x scale.
 *
 * Run: npx tsx scripts/benchmark.ts
 */

import { loadRecords } from "../app/lib/data";
import { buildIndex, matchQuery } from "../app/lib/index";
import type { JobRecord, SearchIndex } from "../app/lib/types";

const BENCHMARK_QUERIES = [
  { label: "Exact + jurisdiction", query: "Assistant Sheriff San Diego County" },
  { label: "Partial title", query: "probation officer" },
  { label: "Jurisdiction only", query: "What jobs are available in San Bernardino?" },
  { label: "Abbreviation", query: "DA san bernardino" },
  { label: "No match", query: "CEO position in Mars" },
  { label: "Single word", query: "meteorologist" },
  { label: "Natural language", query: "What is the salary for the District Attorney?" },
];

const ITERATIONS = 100;

function scaleRecords(base: JobRecord[], factor: number): JobRecord[] {
  if (factor === 1) return [...base];
  const scaled: JobRecord[] = [...base];
  for (let i = 1; i < factor; i++) {
    for (const record of base) {
      scaled.push({
        ...record,
        jurisdiction: `${record.jurisdiction}_scale${i}`,
        code: `${record.code}_${i}`,
      });
    }
  }
  return scaled;
}

function measureBuildTime(records: JobRecord[], iterations: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    buildIndex(records);
    times.push(performance.now() - start);
  }
  return times;
}

function measureQueryTimes(
  index: SearchIndex,
  queries: string[],
  iterations: number
): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    for (const q of queries) {
      const start = performance.now();
      matchQuery(q, index);
      times.push(performance.now() - start);
    }
  }
  return times;
}

function avg(times: number[]): number {
  return times.reduce((a, b) => a + b, 0) / times.length;
}

function p99(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.99)];
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMs(ms: number): string {
  if (ms < 0.01) return "<0.01ms";
  if (ms < 1) return `${ms.toFixed(3)}ms`;
  return `${ms.toFixed(2)}ms`;
}

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

async function run() {
  console.log("=== Holly Search Index Benchmark ===\n");
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Queries per iteration: ${BENCHMARK_QUERIES.length}\n`);

  const baseRecords = await loadRecords();
  console.log(`Base dataset: ${baseRecords.length} records\n`);

  const scales = [1, 10, 100];
  const results: Array<{
    scale: string;
    records: number;
    buildAvg: string;
    buildMedian: string;
    queryAvg: string;
    queryP99: string;
    memoryMB: string;
  }> = [];

  for (const factor of scales) {
    const records = scaleRecords(baseRecords, factor);
    const label = `${factor}x`;

    // Warm up
    const warmupIndex = buildIndex(records);
    for (const q of BENCHMARK_QUERIES) {
      matchQuery(q.query, warmupIndex);
    }

    // Measure memory before
    global.gc?.();
    const memBefore = getMemoryUsageMB();

    // Build benchmark
    const buildTimes = measureBuildTime(records, ITERATIONS);
    const index = buildIndex(records);

    // Memory after index
    const memAfter = getMemoryUsageMB();

    // Query benchmark
    const queryTimes = measureQueryTimes(
      index,
      BENCHMARK_QUERIES.map((q) => q.query),
      ITERATIONS
    );

    results.push({
      scale: label,
      records: records.length,
      buildAvg: formatMs(avg(buildTimes)),
      buildMedian: formatMs(median(buildTimes)),
      queryAvg: formatMs(avg(queryTimes)),
      queryP99: formatMs(p99(queryTimes)),
      memoryMB: `${(memAfter - memBefore).toFixed(1)}MB`,
    });

    console.log(`--- ${label} (${records.length} records) ---`);
    console.log(`  Index build:  avg=${formatMs(avg(buildTimes))}  median=${formatMs(median(buildTimes))}`);
    console.log(`  Query:        avg=${formatMs(avg(queryTimes))}  p99=${formatMs(p99(queryTimes))}`);
    console.log(`  Memory delta: ~${(memAfter - memBefore).toFixed(1)}MB`);
    console.log();
  }

  // Print summary table
  console.log("=== Summary Table ===\n");
  console.log(
    "| Scale | Records | Build (avg) | Build (median) | Query (avg) | Query (p99) | Memory  |"
  );
  console.log(
    "|-------|---------|-------------|----------------|-------------|-------------|---------|"
  );
  for (const r of results) {
    console.log(
      `| ${r.scale.padEnd(5)} | ${String(r.records).padEnd(7)} | ${r.buildAvg.padEnd(11)} | ${r.buildMedian.padEnd(14)} | ${r.queryAvg.padEnd(11)} | ${r.queryP99.padEnd(11)} | ${r.memoryMB.padEnd(7)} |`
    );
  }

  // Per-query breakdown at 1x
  console.log("\n=== Per-Query Breakdown (1x scale) ===\n");
  const index1x = buildIndex(baseRecords);
  for (const { label, query } of BENCHMARK_QUERIES) {
    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      matchQuery(query, index1x);
      times.push(performance.now() - start);
    }
    const resultCount = matchQuery(query, index1x).length;
    console.log(
      `  ${label.padEnd(20)} avg=${formatMs(avg(times)).padEnd(10)} results=${resultCount}  "${query}"`
    );
  }
}

run().catch(console.error);
