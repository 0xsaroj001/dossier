import { describe, expect, it } from "vitest";
import { detectCategory, detectRegion, extractLanguage, extractTopic, parseQuery, validateParsed } from "@/lib/parse";

describe("parseQuery, research", () => {
  it("finds the link and the language in a natural sentence", () => {
    const p = parseQuery("research", "Extract the research paper at https://arxiv.org/abs/1706.03762 in Hindi");
    expect(p.url).toBe("https://arxiv.org/abs/1706.03762");
    expect(p.language).toEqual({ name: "Hindi", code: "hi" });
    expect(validateParsed(p)).toBeNull();
  });

  it("accepts a bare link plus a language", () => {
    const p = parseQuery("research", "https://arxiv.org/abs/2005.14165 in Spanish");
    expect(p.url).toBe("https://arxiv.org/abs/2005.14165");
    expect(p.language?.code).toBe("es");
  });

  it("reads 'translate ... into Tamil'", () => {
    const p = parseQuery("research", "Read https://arxiv.org/abs/1810.04805 and translate the abstract into Tamil");
    expect(p.language?.name).toBe("Tamil");
  });

  it("uses the UI language when the text names none, and treats English as no translation", () => {
    expect(parseQuery("research", "https://arxiv.org/abs/1", "French").language?.code).toBe("fr");
    expect(parseQuery("research", "https://arxiv.org/abs/1 in English").language).toBeNull();
  });

  it("refuses research without a link and private addresses", () => {
    expect(validateParsed(parseQuery("research", "tell me about transformers"))).toMatch(/needs a link/);
    expect(validateParsed(parseQuery("research", "http://localhost:3000/x"))).toMatch(/not public/);
  });
});

describe("parseQuery, news", () => {
  it("separates topic, region and language", () => {
    const p = parseQuery("news", "What's the latest on AI regulation in India, in Hindi");
    expect(p.topic).toBe("AI regulation");
    expect(p.region).toBe("India");
    expect(p.language?.code).toBe("hi");
    expect(p.category).toBe("technology");
  });

  it("maps a section and a country", () => {
    const p = parseQuery("news", "Top technology headlines in the US");
    expect(p.category).toBe("technology");
    expect(p.region).toBe("United States");
    expect(p.language).toBeNull();
  });

  it("does not mistake a language for a region", () => {
    const p = parseQuery("news", "News about the cricket World Cup in Tamil");
    expect(p.topic).toBe("cricket World Cup");
    expect(p.region).toBeNull();
    expect(p.language?.name).toBe("Tamil");
    expect(p.category).toBe("sports");
  });

  it("needs a topic", () => {
    expect(validateParsed(parseQuery("news", "in Hindi"))).toMatch(/needs a topic/);
  });
});

describe("helpers", () => {
  it("extracts the last language mention", () => {
    expect(extractLanguage("translate to french").language?.name).toBe("French");
    expect(extractLanguage("in India in Hindi").language?.name).toBe("Hindi");
    expect(extractLanguage("nothing here").language).toBeNull();
  });
  it("detects regions only after a preposition", () => {
    expect(detectRegion("headlines in India")).toBe("India");
    expect(detectRegion("Indian IT firms")).toBeNull();
  });
  it("categorises topics", () => {
    expect(detectCategory("Nvidia earnings")).toBe("business");
    expect(detectCategory("Chandrayaan landing")).toBeNull();
  });
  it("strips question scaffolding from topics", () => {
    expect(extractTopic("Give me the latest news about the Fed rate decision?")).toBe("Fed rate decision");
  });
});
