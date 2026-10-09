import AxeBuilder from "@axe-core/playwright";
import { test, expect, storyPath, title } from "./browser";

for (const { width, textSize } of [
  { width: 320, textSize: 100 },
  { width: 320, textSize: 200 },
  { width: 1280, textSize: 100 },
  { width: 1280, textSize: 200 },
]) {
  for (const denied of [false, true]) {
    test(`LinkedIn prepares pasteable text at ${width}px/${textSize}% with clipboard ${denied ? "denied" : "allowed"}`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await context.addInitScript((denied) => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (value: string) => {
              if (denied) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
              document.documentElement.dataset.copied = value;
              return Promise.resolve();
            },
          },
        });
      }, denied);
      await context.route("https://www.linkedin.com/sharing/share-offsite/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>LinkedIn navigation fixture</title>",
        }),
      );
      await page.goto(storyPath);
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, textSize);
      await page
        .getByRole("button", { name: `Share: ${title}`, exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Share this story", exact: true });
      const draft = dialog.getByRole("textbox", { name: "Suggested post", exact: true });
      const edited = "My take 😀 & #topic\nA second line without the URL.";
      await draft.fill(edited);
      await dialog.getByRole("button", { name: "LinkedIn (copy post first)", exact: true }).click();
      const expected = `${edited}\n\nhttps://hacksnap.live${storyPath}`;
      const open = dialog.getByRole("link", {
        name: "Open LinkedIn (opens in a new tab)",
        exact: true,
      });
      await expect(open).toBeVisible();
      expect(context.pages()).toHaveLength(1);
      if (denied) {
        const manual = dialog.getByRole("textbox", { name: "Text for manual copy" });
        await expect(manual).toHaveValue(expected);
        await expect(manual).toBeFocused();
        expect(
          await manual.evaluate(
            (node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart,
          ),
        ).toBe(expected.length);
      } else {
        await expect(page.locator("html")).toHaveAttribute("data-copied", expected);
        await expect(dialog.getByRole("status")).toHaveText(
          "Post and link copied. Open LinkedIn, then paste into your post.",
        );
      }
      await open.scrollIntoViewIfNeeded();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`linkedin-${width}-${textSize}-${denied}.png`),
      });
      await expect(open).toHaveAttribute("target", "_blank");
      await expect(open).toHaveAttribute("rel", "noopener noreferrer");
      const href = await open.getAttribute("href");
      expect(new URL(href!).searchParams.get("url")).toBe(`https://hacksnap.live${storyPath}`);
      expect(href).not.toContain(encodeURIComponent(edited));
      const popupPromise = page.waitForEvent("popup");
      await open.click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(href!);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      await popup.close();
      await expect(draft).toHaveValue(edited);
      await draft.fill("A changed draft");
      await expect(open).toHaveCount(0);
      await expect(dialog.getByRole("status", { includeHidden: true })).toBeEmpty();
      await dialog.getByRole("button", { name: "LinkedIn (copy post first)", exact: true }).click();
      await expect(open).toBeVisible();
      await dialog.getByRole("button", { name: "Reset draft", exact: true }).click();
      await expect(open).toHaveCount(0);
    });
  }
}
