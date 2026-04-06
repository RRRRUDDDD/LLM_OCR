import type { Locator, Page } from '@playwright/test';

export class AppPage {
  page: Page;
  title: Locator;
  settingsButton: Locator;
  uploadZone: Locator;
  fileInput: Locator;
  resultPanel: Locator;
  snackbar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('.md-top-app-bar__title');
    this.settingsButton = page.getByRole('button', { name: /设置|Settings/ });
    this.uploadZone = page.locator('.upload-zone');
    this.fileInput = page.locator('#file-input');
    this.resultPanel = page.locator('.result-card');
    this.snackbar = page.locator('.md-snackbar');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async uploadFile(filePath: string): Promise<void> {
    await this.fileInput.setInputFiles(filePath);
  }

  async openSettings(): Promise<void> {
    await this.settingsButton.click();
  }

  async getResultText(): Promise<string | null> {
    return this.resultPanel.locator('.result-text').textContent();
  }

  async isResultVisible(): Promise<boolean> {
    return this.resultPanel.isVisible();
  }

  async getSnackbarText(): Promise<string | null> {
    return this.snackbar.textContent();
  }
}
