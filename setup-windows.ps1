# Start by right-clicking "Open in Terminal" on the unzipped homebase-live folder.
Write-Host "HomeBase setup" -ForegroundColor Green
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Install Node.js 20 or later from https://nodejs.org then run again." -ForegroundColor Yellow
  exit 1
}
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
Write-Host "Opening .env.local. Fill in Supabase + Plaid keys, save and close Notepad." -ForegroundColor Yellow
notepad .env.local
Write-Host "Installing app dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Starting HomeBase on http://localhost:3000" -ForegroundColor Green
npm run dev
