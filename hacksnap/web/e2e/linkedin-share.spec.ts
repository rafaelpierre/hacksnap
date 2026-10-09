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
        window.open = (url, target, features) => {
          document.documentElement.dataset.opened = JSON.stringify([url, target, features]);
          return null;
        };
      }, denied);
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
      const open = dialog.getByRole("button", {
        name: "Open LinkedIn (opens in a new tab)",
        exact: true,
      });
      await expect(open).toBeVisible();
      await expect(page.locator("html")).not.toHaveAttribute("data-opened");
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
      await open.click();
      const opened = JSON.parse((await page.locator("html").getAttribute("data-opened"))!);
      expect(new URL(opened[0]).searchParams.get("url")).toBe(`https://hacksnap.live${storyPath}`);
      expect(opened.slice(1)).toEqual(["_blank", "noopener,noreferrer"]);
      expect(opened[0]).not.toContain(encodeURIComponent(edited));
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
