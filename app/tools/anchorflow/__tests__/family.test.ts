import { describe, expect, it } from "vitest";
import { COMPANY, FAMILY_TOOLS, SITE } from "@/lib/site";

describe("Nor AI family thread", () => {
  it("lists every sibling tool exactly once, never Anchorflow itself", () => {
    const names = FAMILY_TOOLS.map((t) => t.name);
    expect([...names].sort()).toEqual(
      ["Grounded RAG", "Judgewright", "RegexCraft", "SchemaCraft", "Smart Rozgar", "TokenCraft"]
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Anchorflow");
    expect(names).toContain("Grounded RAG");
  });

  it("links to the company and keeps the search title under 60 characters", () => {
    expect(COMPANY.url).toBe("https://norai.tech");
    expect(COMPANY.orgId).toBe("https://norai.tech/#organization");
    expect(SITE.seoTitle).toContain("Nor AI");
    expect(SITE.seoTitle.length).toBeLessThan(60);
  });
});
