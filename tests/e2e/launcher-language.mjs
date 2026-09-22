export async function setLauncherLanguage(page, language = 'en') {
  const previous = await page.evaluate(() => MSWNavigation.current());
  await page.evaluate(() => MSWLauncher.openSettings('settingsAppearancePanel', 'interfaceLanguage'));
  await page.locator('#interfaceLanguage').selectOption(language);
  await page.evaluate(pageId => MSWNavigation.show(pageId), previous);
}
