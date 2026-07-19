<#
.SYNOPSIS
  Eagle OppaiOracle Tagger の配布 zip を作成します。

.DESCRIPTION
  - manifest.json の version からファイル名を生成
  - 含めるファイル・ディレクトリを明示的に指定（allowlist 方式）
  - src/ 内のテスト・検証スクリプトを除外
  - server/__pycache__ を除外
  - 出力: dist/eagle-oppai-tagger-<version>.zip
  - 5MB 超過時は警告（Phase 6 DoD 違反）
  - Windows PowerShell 5.x / PowerShell 7+ 両対応

.PARAMETER OutDir
  zip の出力先ディレクトリ。デフォルト: dist/

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-dist.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-dist.ps1 -OutDir C:\releases
#>
[CmdletBinding()]
param(
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
# ※ Set-StrictMode は PS 5.x と PS 7 で解釈が違うため使用しない。
#    実行時エラーは ErrorActionPreference で捕捉する。

# PS 5.x の Join-Path が一部ケースで $null を返す問題（原因不明）を回避するため、
# .NET API でラップする。PS 5.x / 7 両方で同一動作する。
function JoinPath([string]$parent, [string]$child) {
  return [System.IO.Path]::Combine($parent, $child)
}

# リポジトリルートへ移動（PS 5.x / 7 両方で確実）。
Set-Location (JoinPath $PSScriptRoot "..")
$Root = (Get-Location).Path

# ── バージョン読み込み ───────────────────────────────────────────────
$manifestPath = JoinPath $Root "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "manifest.json が見つかりません: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw "manifest.json に version が定義されていません" }

$pluginName = "eagle-oppai-tagger"
$zipName = "$pluginName-$version.zip"
$stageName = "$pluginName-$version"

# ── パス設定 ─────────────────────────────────────────────────────────
$outDirFull = (New-Item -ItemType Directory -Force -Path (JoinPath $Root $OutDir)).FullName
$stagePath = JoinPath $outDirFull $stageName
$zipPath = JoinPath $outDirFull $zipName

# 既存成果物をクリーンアップ
if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

New-Item -ItemType Directory -Force -Path $stagePath | Out-Null

Write-Host "ビルド: $zipName" -ForegroundColor Cyan
Write-Host "ステージ: $stagePath"
Write-Host ""

# ── 含めるルートファイル（明示的 allowlist） ─────────────────────────
$includeFiles = @(
  "manifest.json",
  "index.html",
  "package.json",
  "package-lock.json",
  "README.md",
  "USER-GUIDE.md",
  "LICENSE",
  "NOTICE"
)

foreach ($file in $includeFiles) {
  $src = JoinPath $Root $file
  if (-not (Test-Path -LiteralPath $src)) {
    Write-Warning "skip (not found): $file"
    continue
  }
  Copy-Item -LiteralPath $src -Destination $stagePath
  Write-Host "  + $file"
}

# ── 含めるディレクトリ ──────────────────────────────────────────────

# assets/（ロゴ等。manifest.json が参照）
$assetsSrc = JoinPath $Root "assets"
if (Test-Path -LiteralPath $assetsSrc) {
  Copy-Item -LiteralPath $assetsSrc -Destination $stagePath -Recurse
  Write-Host "  + assets/"
}

# src/（テスト・verify を除外）
$srcSrc = JoinPath $Root "src"
$srcDst = JoinPath $stagePath "src"
New-Item -ItemType Directory -Force -Path $srcDst | Out-Null

$srcExcludePatterns = @(
  "phase*-test.js",
  "verify.js",
  ".gitkeep"
)

Get-ChildItem -LiteralPath $srcSrc -File | Where-Object {
  $exclude = $false
  foreach ($pattern in $srcExcludePatterns) {
    if ($_.Name -like $pattern) { $exclude = $true; break }
  }
  -not $exclude
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $srcDst
  Write-Host "  + src/$($_.Name)"
}

# server/（Python FastAPI サーバ・__pycache__ 除外）
$serverSrc = JoinPath $Root "server"
if (Test-Path -LiteralPath $serverSrc) {
  $serverDst = JoinPath $stagePath "server"
  New-Item -ItemType Directory -Force -Path $serverDst | Out-Null

  # サブディレクトリ構成を保ってコピー（__pycache__ を除外）
  $excludeDirNames = @("__pycache__", ".venv", "node_modules")

  function Copy-ServerDir($src, $dst) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Get-ChildItem -LiteralPath $src | ForEach-Object {
      if ($_.PSIsContainer) {
        if ($excludeDirNames -contains $_.Name) { return }
        Copy-ServerDir -src $_.FullName -dst (JoinPath $dst $_.Name)
      } else {
        Copy-Item -LiteralPath $_.FullName -Destination $dst
      }
    }
  }

  Copy-ServerDir -src $serverSrc -dst $serverDst
  Write-Host "  + server/ (__pycache__ 除外)"
}

Write-Host ""

# ── zip 作成 ─────────────────────────────────────────────────────────
# Compress-Archive は Windows PowerShell 5.x で -LiteralPath "x/*" を受け付けないため、
# カレントディレクトリをステージに切り替えて相対パスで圧縮する。
Push-Location $stagePath
try {
  Compress-Archive -Path "*" -DestinationPath $zipPath -CompressionLevel Optimal
} finally {
  Pop-Location
}
Write-Host "zip created: $zipPath" -ForegroundColor Green

# ── サイズ検証 ───────────────────────────────────────────────────────
$zipItem = Get-Item -LiteralPath $zipPath
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)
Write-Host ""
Write-Host "サイズ: $sizeMB MB ($($zipItem.Length) bytes)"

$maxBytes = 5MB
if ($zipItem.Length -gt $maxBytes) {
  Write-Warning "Phase 6 DoD 違反: 配布 zip が 5 MB を超えています (目標: <= 5 MB)"
  exit 1
} else {
  Write-Host "DoD OK: <= 5 MB" -ForegroundColor Green
}

# ── ステージングディレクトリを掃除 ──────────────────────────────────
Remove-Item -LiteralPath $stagePath -Recurse -Force

Write-Host ""
Write-Host "完了: $zipPath" -ForegroundColor Cyan
