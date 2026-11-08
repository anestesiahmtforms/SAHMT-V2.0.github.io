import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {prepareFaEntryOnly} from "../scripts/lib/prepare-fa-entry-only.js";
const source=readFileSync(new URL("../apps-script-v2/FaPerformance.gs",import.meta.url),"utf8");
test("FA exposes no performance execution or installation entrypoint",()=>{
 const ctx=vm.createContext({});vm.runInContext(source,ctx);
 for(const name of ["executarDesempenhoFaV1","instalarDesempenhoFaV1","iniciarDesempenhoFaV1"])
  assert.equal(typeof ctx[name],"undefined",name);
});
test("the historical guard patch refuses the pruned source rather than resurrecting entrypoints",()=>{
 assert.throws(()=>prepareFaEntryOnly(source),/FA_ENTRY_POLICY_DRIFT/);
 assert.throws(()=>prepareFaEntryOnly("unexpected"),/SOURCE_DRIFT/);
});
