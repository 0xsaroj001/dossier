import { describe, expect, it } from "vitest";
import { decodeEntities, parseSourceHtml } from "@/lib/source";

const ARXIV = `<html><head>
<title>[1706.03762] Attention Is All You Need</title>
<meta name="description" content="Abstract page for arXiv paper 1706.03762: Attention Is All You Need">
<meta property="og:description" content="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer.">
<meta name="citation_title" content="Attention Is All You Need" />
<meta name="citation_author" content="Vaswani, Ashish" />
<meta name="citation_author" content="Shazeer, Noam" />
<meta name="citation_date" content="2017/06/12" />
</head><body></body></html>`;

describe("page metadata", () => {
  it("reads title, authors, abstract and date from citation and Open Graph tags", () => {
    const s = parseSourceHtml("https://arxiv.org/abs/1706.03762", ARXIV);
    expect(s).toMatchObject({ title: "Attention Is All You Need", authors: ["Vaswani, Ashish", "Shazeer, Noam"], date: "2017/06/12", year: "2017", site: "arxiv.org", method: "meta-tags" });
    expect(s.abstract).toMatch(/^The dominant sequence transduction models/);
  });
  it("skips the short 'Abstract page for' description and falls back to the html title", () => {
    const s = parseSourceHtml("https://x.org/p", `<title>Some &amp; Paper</title><meta name="description" content="Abstract page for arXiv paper 1: x">`);
    expect(s.title).toBe("Some & Paper");
    expect(s.abstract).toBeNull();
  });
  it("decodes entities", () => {
    expect(decodeEntities("a &amp; b &#39;c&#x27; &quot;d&quot;")).toBe("a & b 'c' \"d\"");
  });
});
