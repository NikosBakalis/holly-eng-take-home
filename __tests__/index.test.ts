import { describe, it, expect, beforeAll } from "vitest";
import { getIndex, searchRecords } from "@/lib/index";
import type { SearchIndex, MatchResult } from "@/lib/types";

let index: SearchIndex;

beforeAll(async () => {
  index = await getIndex();
});

// ---- Helper ----

function topMatch(results: MatchResult[]) {
  return results[0]?.record;
}

// ---- Data loading & index construction ----

describe("Index construction", () => {
  it("loads all job records", () => {
    expect(index.records.length).toBeGreaterThan(0);
  });

  it("builds jurisdiction index for each unique jurisdiction", () => {
    const jurisdictions = [...new Set(index.records.map((r) => r.jurisdiction))];
    for (const j of jurisdictions) {
      expect(index.jurisdictionIndex.has(j)).toBe(true);
    }
  });

  it("builds n-gram index with entries", () => {
    expect(index.ngramIndex.size).toBeGreaterThan(0);
  });

  it("derives jurisdiction aliases", () => {
    expect(index.jurisdictionAliases.length).toBeGreaterThan(0);
    for (const alias of index.jurisdictionAliases) {
      expect(alias.key).toBeTruthy();
      expect(alias.tokens.length).toBeGreaterThan(0);
    }
  });

  it("joins salary data to job records", () => {
    const probationOfficerSB = index.records.find(
      (r) => r.code === "01297" && r.jurisdiction === "sanbernardino"
    );
    expect(probationOfficerSB).toBeDefined();
    expect(probationOfficerSB!.salaryGrades.length).toBeGreaterThan(0);
    expect(probationOfficerSB!.salaryGrades[0].value).toContain("$");
  });

  it("handles records with no matching salary data", () => {
    // Appraiser Trainee (ventura/00080) has no salary entry
    const appraiser = index.records.find(
      (r) => r.code === "00080" && r.jurisdiction === "ventura"
    );
    if (appraiser) {
      expect(appraiser.salaryGrades.length).toBe(0);
    }
  });
});

// ---- Exact title + jurisdiction matching ----

describe("Exact title + jurisdiction queries", () => {
  it("matches Assistant Sheriff in San Diego County", async () => {
    const results = await searchRecords("Assistant Sheriff San Diego County");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant Sheriff");
    expect(topMatch(results)?.jurisdiction).toBe("sdcounty");
  });

  it("matches Assistant Chief Probation Officer in San Bernardino", async () => {
    const results = await searchRecords(
      "Assistant Chief Probation Officer San Bernardino"
    );
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant Chief Probation Officer");
    expect(topMatch(results)?.jurisdiction).toBe("sanbernardino");
  });

  it("matches Assistant Chief Probation Officer in Ventura", async () => {
    const results = await searchRecords(
      "Assistant Chief Probation Officer Ventura"
    );
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant Chief Probation Officer");
    expect(topMatch(results)?.jurisdiction).toBe("ventura");
  });

  it("matches Associate Meteorologist in San Diego County", async () => {
    const results = await searchRecords("Associate Meteorologist San Diego");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Associate Meteorologist");
    expect(topMatch(results)?.jurisdiction).toBe("sdcounty");
  });

  it("matches Appraiser Trainee in Ventura", async () => {
    const results = await searchRecords("Appraiser Trainee Ventura");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Appraiser Trainee");
    expect(topMatch(results)?.jurisdiction).toBe("ventura");
  });
});

// ---- Partial title matching ----

describe("Partial title matching", () => {
  it("matches 'probation officer' to Assistant Chief Probation Officer", async () => {
    const results = await searchRecords("probation officer");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(topMatch(results)?.title).toBe("Assistant Chief Probation Officer");
  });

  it("matches 'sheriff' to Assistant Sheriff", async () => {
    const results = await searchRecords("sheriff");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant Sheriff");
  });

  it("matches 'meteorologist' to Associate Meteorologist", async () => {
    const results = await searchRecords("meteorologist");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Associate Meteorologist");
  });

  it("matches 'human resources' to Assistant Director of Human Resources", async () => {
    const results = await searchRecords("human resources");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe(
      "Assistant Director of Human Resources"
    );
  });

  it("matches 'district attorney' to Assistant District Attorney", async () => {
    const results = await searchRecords("district attorney");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant District Attorney");
  });
});

// ---- Abbreviation handling ----

describe("Abbreviation handling", () => {
  it("expands 'SD County' to San Diego County", async () => {
    const results = await searchRecords("Assistant Sheriff SD County");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.jurisdiction).toBe("sdcounty");
  });

  it("expands 'DA' to District Attorney", async () => {
    const results = await searchRecords("DA san bernardino");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant District Attorney");
  });

  it("expands 'HR' to Human Resources", async () => {
    const results = await searchRecords("HR director san bernardino");
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe(
      "Assistant Director of Human Resources"
    );
  });
});

// ---- Jurisdiction disambiguation ----

describe("Jurisdiction disambiguation", () => {
  it("returns both jurisdictions when title matches without jurisdiction", async () => {
    const results = await searchRecords("Assistant Chief Probation Officer");
    expect(results.length).toBe(2);
    const jurisdictions = results.map((r) => r.record.jurisdiction).sort();
    expect(jurisdictions).toEqual(["sanbernardino", "ventura"]);
  });

  it("filters to correct jurisdiction when specified", async () => {
    const ventura = await searchRecords(
      "Assistant Chief Probation Officer Ventura"
    );
    expect(ventura.length).toBe(1);
    expect(topMatch(ventura)?.jurisdiction).toBe("ventura");

    const sb = await searchRecords(
      "Assistant Chief Probation Officer San Bernardino"
    );
    expect(sb.length).toBe(1);
    expect(topMatch(sb)?.jurisdiction).toBe("sanbernardino");
  });
});

// ---- Jurisdiction-only queries ----

describe("Jurisdiction-only queries", () => {
  it("returns all San Bernardino jobs when only jurisdiction is given", async () => {
    const results = await searchRecords("What jobs are available in San Bernardino?");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.record.jurisdiction).toBe("sanbernardino");
    }
  });

  it("returns all Ventura jobs when only jurisdiction is given", async () => {
    const results = await searchRecords("Show me positions in Ventura");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.record.jurisdiction).toBe("ventura");
    }
  });

  it("returns all San Diego County jobs when only jurisdiction is given", async () => {
    const results = await searchRecords("List roles in San Diego County");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.record.jurisdiction).toBe("sdcounty");
    }
  });
});

// ---- Natural language queries ----

describe("Natural language queries", () => {
  it("handles salary questions", async () => {
    const results = await searchRecords(
      "What is the salary for the Assistant District Attorney in San Bernardino?"
    );
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Assistant District Attorney");
  });

  it("handles duty/responsibility questions", async () => {
    const results = await searchRecords(
      "What are the duties of the public information specialist in ventura?"
    );
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Apcd Public Information Specialist");
  });

  it("handles qualification questions", async () => {
    const results = await searchRecords(
      "What qualifications do I need for the Associate Meteorologist in San Diego County?"
    );
    expect(results.length).toBe(1);
    expect(topMatch(results)?.title).toBe("Associate Meteorologist");
  });
});

// ---- Edge cases ----

describe("Edge cases", () => {
  it("returns empty for unrelated queries", async () => {
    const results = await searchRecords("hello");
    expect(results.length).toBe(0);
  });

  it("returns empty for nonsense queries", async () => {
    const results = await searchRecords("What is the weather today?");
    expect(results.length).toBe(0);
  });

  it("returns empty for jobs not in the dataset", async () => {
    const results = await searchRecords("Tell me about the CEO position");
    expect(results.length).toBe(0);
  });

  it("returns empty for wrong jurisdiction", async () => {
    const results = await searchRecords(
      "How do I apply for a firefighter job in Los Angeles?"
    );
    expect(results.length).toBe(0);
  });

  it("returns all records when query contains only stopwords", async () => {
    const results = await searchRecords("what is the for a");
    // All tokens are stopwords, no jurisdiction detected — returns all records with score 0
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBe(0);
    }
  });
});

// ---- Scoring correctness ----

describe("Scoring", () => {
  it("scores exact title matches higher than partial matches", async () => {
    const results = await searchRecords("Assistant Chief Probation Officer San Bernardino");
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(5);
  });

  it("scores single-word matches lower", async () => {
    const results = await searchRecords("assistant");
    // "assistant" matches multiple titles, all with low score (unigram only)
    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
