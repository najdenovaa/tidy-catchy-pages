import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
describe("single pressure engine for all primary consumers",()=>{
  for(const path of ["src/pages/Index.tsx","src/lib/cement-optimizer.ts","src/lib/export-docx.ts"]){
    it(path,()=>{
      const source=readFileSync(resolve(process.cwd(),path),"utf8");
      expect(source).toContain("cementing-engine");
      const imports=Array.from(source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g));
      const invalid=imports.filter(m=>m[2].endsWith("cementing-calculations") &&
        m[1].split(",").some(p=>p.trim()==="calculatePressureProfile"));
      expect(invalid).toHaveLength(0);
    });
  }
});
