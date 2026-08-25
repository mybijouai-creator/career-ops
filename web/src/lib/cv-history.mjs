/**
 * cv-history.mjs — an append-only record of every tailored CV a web `pdf` run
 * has actually rendered, keyed by report number.
 *
 * `/api/cv-pdf` and lib/apply/cv.ts's resolveTailoredCv() already surface the
 * MOST RECENT tailored CV per company by fuzzy-matching filenames in output/
 * — good enough for "attach the CV I just tailored" during apply, but not a
 * browsable history: it can't tell two tailored CVs for the same company
 * apart, and it has no idea which base CV (see cv-library.mjs) was active
 * when a given one was generated.
 *
 * This is the explicit, structured complement: one row per successful
 * render, appended by web/src/app/api/run/route.ts right after
 * renderAndMarkPdf() confirms the PDF actually exists on disk. Same
 * conventions as the repo's other append-only TSV logs (data/assessments.tsv,
 * data/gates.tsv): never rewritten, reject a field containing a tab/newline
 * rather than escape it, `-` is the "not applicable" sentinel.
 *
 * Plain .mjs (same pattern as cv-library.mjs / pdf-paths.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step.
 */
import fs from "node:fs";
import path from "node:path";

const HEADER_COMMENT = [
  "# cv-history.tsv — append-only log of tailored CVs the web app has rendered. Never rewrite rows.",
  "# {date}\\t{reportNum}\\t{companySlug}\\t{baseCvId|-}\\t{baseCvName|-}\\t{outputFile}",
].join("\n");

export function cvHistoryPath(root) {
  return path.join(root, "data", "cv-history.tsv");
}

function reject(name, value) {
  if (value.includes("\t") || value.includes("\n")) {
    throw new Error(`cv-history: ${name} must not contain tabs or newlines`);
  }
  return value;
}

/**
 * Turn a filename slug ("acme-corp") into a readable label ("Acme Corp") for
 * display when the caller has no nicer name on hand. Exported so the reader
 * (an API route rendering the history list) and any test can share it rather
 * than each guessing their own title-casing.
 */
export function humanizeSlug(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Append one row. Every field is required except baseCvId/baseCvName, which
 * are `-` when the tenant has never used the named-CV feature (cv.md was the
 * only CV, same as before this feature existed) — recorded explicitly rather
 * than left blank, so a reader can tell "no multi-CV in use" apart from a
 * malformed row.
 * @param {string} root
 * @param {{date: string, reportNum: string, companySlug: string, baseCvId?: string|null, baseCvName?: string|null, outputFile: string}} entry
 */
export function appendCvHistoryEntry(root, entry) {
  const date = reject("date", String(entry.date ?? ""));
  const reportNum = reject("reportNum", String(entry.reportNum ?? ""));
  const companySlug = reject("companySlug", String(entry.companySlug ?? ""));
  const baseCvId = reject("baseCvId", String(entry.baseCvId ?? "") || "-");
  const baseCvName = reject("baseCvName", String(entry.baseCvName ?? "") || "-");
  const outputFile = reject("outputFile", String(entry.outputFile ?? ""));
  if (!date || !reportNum || !companySlug || !outputFile) {
    throw new Error("cv-history: date, reportNum, companySlug and outputFile are required");
  }

  const row = [date, reportNum, companySlug, baseCvId, baseCvName, outputFile].join("\t");
  const file = cvHistoryPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = "";
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8");
    prefix = existing.endsWith("\n") || existing === "" ? "" : "\n";
  } else {
    prefix = `${HEADER_COMMENT}\n`;
  }
  fs.appendFileSync(file, prefix + row + "\n");
}

/**
 * Parsed rows, NEWEST FIRST (the natural order for a history list — the log
 * itself is append-only oldest-first on disk). Tolerant of hand-edits: a row
 * with too few cells is skipped and counted in `malformed` rather than
 * throwing, same discipline as assessment-log.mjs's parser.
 * @returns {{entries: object[], malformed: number}}
 */
export function readCvHistory(root) {
  let content;
  try {
    content = fs.readFileSync(cvHistoryPath(root), "utf8");
  } catch {
    return { entries: [], malformed: 0 };
  }

  const entries = [];
  let malformed = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const cells = t.split("\t").map((c) => c.trim());
    const [date, reportNum, companySlug, baseCvId, baseCvName, outputFile] = cells;
    if (cells.length < 6 || !date || !reportNum || !companySlug || !outputFile) {
      malformed++;
      continue;
    }
    entries.push({
      date,
      reportNum,
      companySlug,
      companyLabel: humanizeSlug(companySlug),
      baseCvId: baseCvId === "-" ? null : baseCvId,
      baseCvName: baseCvName === "-" ? null : baseCvName,
      outputFile,
    });
  }
  entries.reverse();
  return { entries, malformed };
}
