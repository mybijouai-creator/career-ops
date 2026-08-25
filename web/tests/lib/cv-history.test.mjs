// Tests for web/src/lib/cv-history.mjs — the append-only per-report record of
// tailored CVs the web app has actually rendered.
//
// Run:  node --test tests/lib/cv-history.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCvHistoryEntry, readCvHistory, humanizeSlug, cvHistoryPath } from "../../src/lib/cv-history.mjs";

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-history-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("humanizeSlug: title-cases a hyphenated slug", () => {
  assert.equal(humanizeSlug("acme-corp"), "Acme Corp");
  assert.equal(humanizeSlug("meta"), "Meta");
  assert.equal(humanizeSlug(""), "");
});

test("readCvHistory: empty (no file yet) for a tenant that has never generated a tailored CV", () => {
  withTempRoot((root) => {
    assert.deepEqual(readCvHistory(root), { entries: [], malformed: 0 });
    assert.equal(fs.existsSync(cvHistoryPath(root)), false, "reading must not create the file");
  });
});

test("appendCvHistoryEntry + readCvHistory: round-trips a full row, newest first", () => {
  withTempRoot((root) => {
    appendCvHistoryEntry(root, {
      date: "2026-08-01",
      reportNum: "010",
      companySlug: "acme-corp",
      baseCvId: "backend",
      baseCvName: "Backend",
      outputFile: "cv-jane-smith-acme-corp-2026-08-01.pdf",
    });
    appendCvHistoryEntry(root, {
      date: "2026-08-02",
      reportNum: "011",
      companySlug: "globex",
      baseCvId: null,
      baseCvName: null,
      outputFile: "cv-jane-smith-globex-2026-08-02.pdf",
    });

    const { entries, malformed } = readCvHistory(root);
    assert.equal(malformed, 0);
    assert.equal(entries.length, 2);
    // newest first
    assert.equal(entries[0].reportNum, "011");
    assert.equal(entries[0].baseCvId, null, "the '-' sentinel round-trips back to null, not the literal string");
    assert.equal(entries[0].companyLabel, "Globex");
    assert.equal(entries[1].reportNum, "010");
    assert.equal(entries[1].baseCvId, "backend");
    assert.equal(entries[1].baseCvName, "Backend");
    assert.equal(entries[1].companyLabel, "Acme Corp");
  });
});

test("appendCvHistoryEntry: writes a header comment on first use", () => {
  withTempRoot((root) => {
    appendCvHistoryEntry(root, { date: "2026-08-01", reportNum: "010", companySlug: "acme", outputFile: "cv.pdf" });
    const raw = fs.readFileSync(cvHistoryPath(root), "utf8");
    assert.match(raw, /^# cv-history\.tsv/);
  });
});

test("appendCvHistoryEntry: rejects a field containing a tab or newline rather than silently corrupting the row", () => {
  withTempRoot((root) => {
    assert.throws(
      () => appendCvHistoryEntry(root, { date: "2026-08-01", reportNum: "010", companySlug: "acme\tcorp", outputFile: "cv.pdf" }),
      /must not contain tabs or newlines/,
    );
  });
});

test("appendCvHistoryEntry: requires the non-optional fields", () => {
  withTempRoot((root) => {
    assert.throws(() => appendCvHistoryEntry(root, { date: "", reportNum: "010", companySlug: "acme", outputFile: "cv.pdf" }), /required/);
  });
});

test("readCvHistory: a malformed hand-edited row is skipped and counted, not thrown", () => {
  withTempRoot((root) => {
    appendCvHistoryEntry(root, { date: "2026-08-01", reportNum: "010", companySlug: "acme", outputFile: "cv.pdf" });
    fs.appendFileSync(cvHistoryPath(root), "not\tenough\tcells\n");

    const { entries, malformed } = readCvHistory(root);
    assert.equal(entries.length, 1);
    assert.equal(malformed, 1);
  });
});
