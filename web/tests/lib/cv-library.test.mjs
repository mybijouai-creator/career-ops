// Tests for web/src/lib/cv-library.mjs — named base CVs layered on top of
// the single cv.md every other part of career-ops still reads directly.
//
// Run:  node --test tests/lib/cv-library.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCvs,
  getCv,
  createCv,
  updateCv,
  renameCv,
  deleteCv,
  activateCv,
  peekActiveCv,
  isValidCvId,
} from "../../src/lib/cv-library.mjs";

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-library-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a brand-new tenant (no cv.md, no cvs/) has an empty list and does not create cvs/ on disk", () => {
  withTempRoot((root) => {
    const { activeId, cvs } = listCvs(root);
    assert.equal(activeId, null);
    assert.deepEqual(cvs, []);
    assert.equal(fs.existsSync(path.join(root, "cvs")), false, "a mere read must not create a stray cvs/ dir");
  });
});

test("a tenant with a legacy cv.md is migrated into a single 'Default' CV, once, non-destructively", () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, "cv.md"), "# Jane Smith\n\nlegacy content");

    const { activeId, cvs } = listCvs(root);
    assert.equal(activeId, "default");
    assert.equal(cvs.length, 1);
    assert.equal(cvs[0].name, "Default");
    assert.equal(cvs[0].active, true);

    const full = getCv(root, "default");
    assert.equal(full.content, "# Jane Smith\n\nlegacy content");
    // cv.md itself is untouched by the migration (still the same content, no .bak written)
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "# Jane Smith\n\nlegacy content");
  });
});

test("migration only ever happens once — a cv.md edited after migration does not resurrect or overwrite the named CV", () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, "cv.md"), "original");
    listCvs(root); // triggers migration
    fs.writeFileSync(path.join(root, "cv.md"), "edited directly, bypassing the library");

    const full = getCv(root, "default");
    assert.equal(full.content, "original", "the named CV keeps what it was migrated with, not a re-read of cv.md");
  });
});

test("createCv: the first CV ever created is automatically active and mirrored into cv.md", () => {
  withTempRoot((root) => {
    const created = createCv(root, { name: "Backend", content: "# Backend CV" });
    assert.equal(created.active, true);
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "# Backend CV");

    const { activeId, cvs } = listCvs(root);
    assert.equal(activeId, created.id);
    assert.equal(cvs.length, 1);
  });
});

test("createCv: a second CV is NOT active and does not touch cv.md", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "backend content" });
    const second = createCv(root, { name: "AI/ML", content: "ai content" });

    assert.equal(second.active, false);
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "backend content", "cv.md still mirrors the first (active) CV");
    assert.equal(listCvs(root).cvs.length, 2);
  });
});

test("createCv: collisions on the derived id get a numeric suffix, ids stay stable afterwards", () => {
  withTempRoot((root) => {
    const a = createCv(root, { name: "Backend", content: "a" });
    const b = createCv(root, { name: "Backend", content: "b" });
    assert.equal(a.id, "backend");
    assert.equal(b.id, "backend-2");
    assert.notEqual(a.id, b.id);
  });
});

test("createCv: a CV named 'History' never gets the id 'history' — that's the static /api/cvs/history route's turf", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "History", content: "x" });
    assert.notEqual(cv.id, "history");
    assert.equal(cv.id, "history-2");
  });
});

test("createCv: rejects an empty name and an oversized CV", () => {
  withTempRoot((root) => {
    assert.throws(() => createCv(root, { name: "   ", content: "x" }), /name is required/);
    assert.throws(() => createCv(root, { name: "Big", content: "x".repeat(200_001) }), /too large/);
  });
});

test("updateCv: updates a non-active CV without touching cv.md", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "backend v1" });
    const second = createCv(root, { name: "AI/ML", content: "ai v1" });

    const updated = updateCv(root, second.id, "ai v2");
    assert.equal(updated.content, "ai v2");
    assert.equal(updated.active, false);
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "backend v1", "unrelated to the non-active CV being edited");
    assert.equal(getCv(root, second.id).content, "ai v2");
  });
});

test("updateCv: updating the ACTIVE CV keeps cv.md in sync, backing up its prior content", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "Backend", content: "v1" });
    const updated = updateCv(root, cv.id, "v2");

    assert.equal(updated.active, true);
    assert.equal(updated.backedUp, true);
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "v2");
    const baks = fs.readdirSync(root).filter((f) => f.startsWith("cv.md.bak-"));
    assert.equal(baks.length, 1);
    assert.equal(fs.readFileSync(path.join(root, baks[0]), "utf8"), "v1");
  });
});

test("updateCv: returns null for an unknown id rather than creating one", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "v1" });
    assert.equal(updateCv(root, "does-not-exist", "x"), null);
  });
});

test("renameCv: changes the display name, never the id", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "Backend", content: "x" });
    const renamed = renameCv(root, cv.id, "Backend Engineering");
    assert.equal(renamed.id, cv.id);
    assert.equal(renamed.name, "Backend Engineering");
    assert.equal(listCvs(root).cvs[0].name, "Backend Engineering");
  });
});

test("deleteCv: refuses to delete the active CV", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "Backend", content: "x" });
    const result = deleteCv(root, cv.id);
    assert.equal(result.ok, false);
    assert.equal(result.error, "is-active");
    assert.equal(listCvs(root).cvs.length, 1, "nothing was removed");
  });
});

test("deleteCv: removes a non-active CV, file and index entry alike", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "backend" });
    const second = createCv(root, { name: "AI/ML", content: "ai" });

    const result = deleteCv(root, second.id);
    assert.equal(result.ok, true);
    assert.equal(listCvs(root).cvs.length, 1);
    assert.equal(getCv(root, second.id), null);
    assert.equal(fs.existsSync(path.join(root, "cvs", `${second.id}.md`)), false);
  });
});

test("deleteCv: unknown id reports not-found", () => {
  withTempRoot((root) => {
    assert.deepEqual(deleteCv(root, "ghost"), { ok: false, error: "not-found" });
  });
});

test("activateCv: switches cv.md over to the newly-activated CV's content, backing up the prior one", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "backend content" });
    const ml = createCv(root, { name: "AI/ML", content: "ml content" });

    const result = activateCv(root, ml.id);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyActive, false);
    assert.equal(result.backedUp, true);
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "ml content");
    assert.equal(listCvs(root).activeId, ml.id);
    assert.equal(getCv(root, ml.id).active, true);
  });
});

test("activateCv: activating the already-active CV is a harmless no-op", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "Backend", content: "x" });
    const result = activateCv(root, cv.id);
    assert.deepEqual(result, { ok: true, alreadyActive: true });
  });
});

test("activateCv: unknown id reports not-found and touches nothing", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "x" });
    const result = activateCv(root, "ghost");
    assert.deepEqual(result, { ok: false, error: "not-found" });
    assert.equal(fs.readFileSync(path.join(root, "cv.md"), "utf8"), "x");
  });
});

test("peekActiveCv: null for a tenant that has never used the multi-CV feature, without migrating cv.md as a side effect", () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, "cv.md"), "legacy, never opened the switcher");
    assert.equal(peekActiveCv(root), null);
    assert.equal(fs.existsSync(path.join(root, "cvs")), false, "peeking must never trigger migration");
  });
});

test("peekActiveCv: the active CV's id+name once the feature is in use", () => {
  withTempRoot((root) => {
    const cv = createCv(root, { name: "Backend", content: "x" });
    assert.deepEqual(peekActiveCv(root), { id: cv.id, name: "Backend" });
  });
});

test("isValidCvId: accepts generated slugs, rejects path-traversal and empty/oversized input", () => {
  assert.equal(isValidCvId("backend"), true);
  assert.equal(isValidCvId("backend-2"), true);
  assert.equal(isValidCvId("../../etc/passwd"), false);
  assert.equal(isValidCvId(""), false);
  assert.equal(isValidCvId("-leading-hyphen"), false);
  assert.equal(isValidCvId("a".repeat(65)), false);
  assert.equal(isValidCvId(null), false);
});

test("getCv: unknown id returns null", () => {
  withTempRoot((root) => {
    createCv(root, { name: "Backend", content: "x" });
    assert.equal(getCv(root, "ghost"), null);
  });
});
