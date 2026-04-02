export class AppPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator('.md-top-app-bar__title');
    this.settingsButton = page.locator('button[aria-label="设置"]');
    this.uploadZone = page.locator('.upload-zone');
    this.fileInput = page.locator('#file-input');
    this.resultPanel = page.locator('.result-card');
    this.snackbar = page.locator('.md-snackbar');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async uploadFile(filePath) {
    await this.fileInput.setInputFiles(filePath);
  }

  async openSettings() {
    await this.settingsButton.click();
  }

  async getResultText() {
    return this.resultPanel.locator('.result-text').textContent();
  }

  async isResultVisible() {
    return this.resultPanel.isVisible();
  }

  async getSnackbarText() {
    return this.snackbar.textContent();
  }
}
