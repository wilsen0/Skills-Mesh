import assert from "node:assert/strict";
import test from "node:test";
import { loadDoctrineCards, loadRuleCards, validateRuleDocs } from "../dist/runtime/rules-loader.js";

test("canonical rules and doctrines load from JSON cards and markdown stays in sync", async () => {
  const [rules, doctrines, validation] = await Promise.all([
    loadRuleCards(),
    loadDoctrineCards(),
    validateRuleDocs(),
  ]);

  assert.ok(rules.length >= 3);
  assert.ok(doctrines.length >= 4);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missingInDocs, []);
});
