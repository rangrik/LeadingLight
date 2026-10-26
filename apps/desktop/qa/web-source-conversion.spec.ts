import { expect, test } from "@playwright/test";

// Seam: readable HTML becomes schema-valid blocks without dropping mixed text or counting media twice.
test("Article conversion preserves mixed text, nested lists, and media once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Recent" }).getByRole("button", { name: "New page" }).click();
  const result = await page.evaluate(async () => {
    const sourceModule = "/src/lib/web-source.ts";
    const { readArticle } = await import(sourceModule);
    const article = readArticle(`<title>Mixed source</title><article>
      <div>Before <strong>bold <b>still bold</b></strong> after<p>Inner paragraph</p>tail.</div>
      <ul><li>List direct<p>List paragraph</p><ul><li>Nested text</li></ul>List tail<img src="data:image/gif;base64,abc" data-src="/list.png"></li></ul>
      <blockquote><p>Before image<img src="/quote.png">after image</p></blockquote>
      <p><a href="javascript:alert(1)">Unsafe link text</a></p></article>`, "https://example.com/source");
    const doc = (window as any).__editor.schema.nodeFromJSON({ type: "doc", content: article.content });
    doc.check();
    let emptyRefused = false;
    try { readArticle("<script>bad()</script>", "https://example.com"); } catch { emptyRefused = true; }
    return { text: doc.textContent, content: article.content, media: article.media.map((n: any) => n.attrs.src), emptyRefused };
  });
  expect(result.text).toBe("Before bold still bold afterInner paragraphtail.List directList paragraphNested textList tailBefore imageafter imageUnsafe link text");
  expect(result.media).toEqual(["https://example.com/list.png", "https://example.com/quote.png"]);
  const list = result.content.find((n: any) => n.type === "bulletList");
  expect(list.content[0].content.map((n: any) => n.type)).toEqual(["paragraph", "paragraph", "bulletList", "paragraph", "image"]);
  expect(JSON.stringify(result.content)).not.toContain("javascript:");
  expect(result.emptyRefused).toBe(true);
});
