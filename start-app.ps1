$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($args.Count -gt 0) { $args[0] } else { "5173" }

$nodeCandidates = @(
  "node",
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "$env:LocalAppData\Programs\nodejs\node.exe",
  "$env:LocalAppData\OpenAI\Codex\bin\node.exe"
)

$nodePath = $null
foreach ($candidate in $nodeCandidates) {
  try {
    if ($candidate -eq "node") {
      $cmd = Get-Command node -ErrorAction SilentlyContinue
      if ($cmd) {
        $nodePath = $cmd.Source
        break
      }
    } elseif ($candidate -and (Test-Path $candidate)) {
      $nodePath = $candidate
      break
    }
  } catch {
    continue
  }
}

if (-not $nodePath) {
  Write-Host "Node.js was not found." -ForegroundColor Red
  Write-Host "Install Node.js LTS from https://nodejs.org, reopen PowerShell, then run this script again."
  exit 1
}

if (-not (Test-Path (Join-Path $root ".env"))) {
  Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
  Write-Host "Created .env from .env.example. Add your API key before extracting receipts." -ForegroundColor Yellow
}

Write-Host "Starting Receipt Form Auto-Fill on http://localhost:$port" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server."
& $nodePath (Join-Path $root "server.js") $port
