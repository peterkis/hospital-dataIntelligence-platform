import { describe, expect, test } from "vitest";
import {
  runGateM0,
  verifyPackageCoverage,
  verifyParserBoundaries,
} from "./p0-10-gate.mjs";

describe("P0-10 M0 synthetic gate", () => {
  test("keeps the package complete while leaving field ownership outside P0-10", () => {
    const result = verifyPackageCoverage();

    expect(result.status).toBe("PASS");
    expect(result.syntheticOnly).toBe(true);
    expect(result.counts).toEqual({
      datasets: 53,
      fields: 866,
      conditions: 196,
      inScopeConditions: 77,
    });
    expect(result.domainImplementationOwners).toBe(0);
    expect(result.demos).toEqual([
      { dataset: "ORG01", fieldCount: 19, format: "CSV", execution: "PARSER_REPORT_ONLY" },
      { dataset: "ORG04", fieldCount: 18, format: "JSON", execution: "PARSER_REPORT_ONLY" },
      { dataset: "PER01", fieldCount: 18, format: "XLSX", execution: "PARSER_REPORT_ONLY" },
    ]);
  });

  test("runs the three-format parser path and its structural negatives", () => {
    const result = verifyParserBoundaries();

    expect(result.status).toBe("PASS");
    expect(result.positiveFormats).toBe(3);
    expect(result.negativeCases).toBe(18);
    expect(result.boundary).toEqual({ rowsAtLimit: 1000, rowsOverLimit: 1001 });
    expect(result.demoReports.map((report) => report.format)).toEqual(["CSV", "JSON", "XLSX"]);
  });

  test("cannot report M0 complete without browser and current-tree review evidence", () => {
    const result = runGateM0({
      packageCoverage: { status: "PASS", syntheticOnly: true },
      parser: { status: "PASS", positiveFormats: 3, syntheticOnly: true },
      integration: {
        status: "PASS",
        noDomainWrites: true,
        domainCountsStable: true,
        domainCounts: { fresh: {}, legacy: {} },
        restartRecovery: true,
        restartEvidence: { status: "PASS", receiptBound: true, recovered: true },
      },
      browser: { status: "PARTIAL" },
      review: { status: "NOT_RUN" },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.checks["P0-10-AC-01"]).toBe(true);
    expect(result.checks["P0-10-AC-03"]).toBe(true);
    expect(result.evidence.browser).toBe(false);
    expect(result.evidence.review).toBe(false);
    expect(result.blockers).toContain("P0-10-AC-05");
  });
});
