import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import * as path from "path";

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, "..", "dist", "main", "index.js")],
    env: {
      ...process.env,
      // Tell the main process to load built renderer files instead of localhost:5173
      ELECTRON_E2E: "1",
    },
    timeout: 15_000,
  });

  // Wait for the first BrowserWindow to open
  page = await app.firstWindow();

  // Wait for the renderer to fully load
  await page.waitForLoadState("load");
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
});

test("app launches and window opens", async () => {
  // The window should exist and have a title
  const title = await page.title();
  expect(title).toBeDefined();

  // Window should be visible
  const window = await app.browserWindow(page);
  const isVisible = await window.evaluate(
    (win: { isVisible: () => boolean }) => win.isVisible()
  );
  expect(isVisible).toBe(true);
});

test("store page loads with heading", async () => {
  // The Store page is the default route ("/")
  // Look for the "BOILERDECK" logo text in the sidebar
  const logo = page.locator("text=BOILERDECK");
  await expect(logo).toBeVisible({ timeout: 10_000 });

  // The Store heading should be present (or "Loading games..." while fetching)
  const storeHeading = page.locator("h1", { hasText: "Store" });
  const loadingText = page.locator("text=Loading games...");

  // Either the heading or loading text should be visible
  await expect(storeHeading.or(loadingText)).toBeVisible({ timeout: 10_000 });
});

test("navigation to Library works", async () => {
  // Click on the Library nav item in the sidebar
  const libraryNav = page.locator("div[role='button']", { hasText: "Library" });
  await libraryNav.click();

  // The URL hash should change to #/library
  await page.waitForURL(/(#\/library|\/library)/, { timeout: 5_000 });
});

test("navigation to Downloads works", async () => {
  // Click on the Downloads nav item
  const downloadsNav = page.locator("div[role='button']", { hasText: "Downloads" });
  await downloadsNav.click();

  await page.waitForURL(/(#\/downloads|\/downloads)/, { timeout: 5_000 });
});

test("can navigate back to Store", async () => {
  // Click on the Store nav item
  const storeNav = page.locator("div[role='button']", { hasText: "Store" });
  await storeNav.click();

  // Should show the Store heading again
  const storeHeading = page.locator("h1", { hasText: "Store" });
  const loadingText = page.locator("text=Loading games...");

  await expect(storeHeading.or(loadingText)).toBeVisible({ timeout: 10_000 });
});
