#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

Write-Host "RideIQ check (Windows / PowerShell)" -ForegroundColor Cyan

function Ensure-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is not installed or not on PATH."
  }
}

Ensure-Command pnpm

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (pnpm install)..." -ForegroundColor Yellow
  pnpm install
}

Write-Host "Running repo checks (pnpm check)..." -ForegroundColor Yellow
pnpm check

Write-Host "Running schema contract check..." -ForegroundColor Yellow
pnpm schema:check

Write-Host "Attempting Supabase database lint/tests (optional)..." -ForegroundColor Yellow

if (Get-Command supabase -ErrorAction SilentlyContinue) {
  try {
    supabase start | Out-Null
    supabase db reset --no-seed | Out-Null
    supabase db lint --level error
    supabase test db
  } finally {
    try { supabase stop | Out-Null } catch {}
  }
} else {
  Write-Host "Supabase CLI not found; skipping db lint/tests. (Install: npm i -g supabase)" -ForegroundColor DarkYellow
}

Write-Host "✅ All checks completed." -ForegroundColor Green
