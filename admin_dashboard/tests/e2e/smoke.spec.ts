import { test, expect } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
});

test('forbidden page renders', async ({ page }) => {
  await page.goto('/forbidden');
  await expect(page.getByRole('heading', { name: '403 — Forbidden' })).toBeVisible();
});
