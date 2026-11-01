import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("single source of pressure-profile results",()=>{
  const consumers=["src/pages/Index.tsx","src/lib/cement-optimizer.ts","src/lib/export-docx.ts"];
  it("routes interactive UI, optimization and report through one engine",()=>{
    consumers.forEach(path=>{
      const source=readFileSync(resolve(process.cwd(),path),"utf8");
      expect(source).toContain("cementing-engine");
      expect(source).toMatch(/calculatePressureProfile\s*\(/);
      const directImports=[...source.matchAll(/import\s*(?:[\s\S]*?)from\s*["']([^"']*cementing-calculations)["']/g)]
        .filter(x=>/\bcalculatePressureProfile\b/.test(x[0]));
      expect(directImports, path).toHaveLength(0);
    });
  });
});
