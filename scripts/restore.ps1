param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
if (-not $Force) {
  throw "La restauration remplace les données actuelles. Relancez avec -Force après vérification."
}

$racineProjet = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$source = (Resolve-Path -LiteralPath $BackupDirectory).Path
$dump = Get-ChildItem -LiteralPath $source -Filter "*.dump" -File | Select-Object -First 1
if (-not $dump) { throw "Aucun fichier .dump trouvé dans $source." }

$manifest = Join-Path $source "manifest.txt"
if (Test-Path -LiteralPath $manifest) {
  $ligneHash = Get-Content -LiteralPath $manifest | Where-Object { $_ -like "sha256=*" } | Select-Object -First 1
  if ($ligneHash) {
    $hashAttendu = $ligneHash.Substring(7)
    $hashActuel = (Get-FileHash -Algorithm SHA256 -LiteralPath $dump.FullName).Hash
    if ($hashActuel -ne $hashAttendu) { throw "L'empreinte du dump ne correspond pas au manifeste." }
  }
}

$dumpConteneur = "/tmp/restauration-courtier.dump"
Push-Location $racineProjet
try {
  docker compose cp $dump.FullName "db:$dumpConteneur" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "La copie du dump a échoué." }
  docker compose exec -T db pg_restore -U courtier -d courtier_portefeuille --clean --if-exists --no-owner $dumpConteneur
  if ($LASTEXITCODE -ne 0) { throw "La restauration PostgreSQL a échoué." }
  docker compose exec -T db rm -f $dumpConteneur

  $archivePieces = Get-ChildItem -LiteralPath $source -Filter "pieces-jointes-*.zip" -File | Select-Object -First 1
  if ($archivePieces) {
    $cibleUploads = [System.IO.Path]::GetFullPath((Join-Path $racineProjet "uploads"))
    if (-not $cibleUploads.StartsWith($racineProjet, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Chemin de restauration des pièces jointes invalide."
    }
    if (Test-Path -LiteralPath $cibleUploads) {
      Remove-Item -LiteralPath $cibleUploads -Recurse -Force
    }
    New-Item -ItemType Directory -Path $cibleUploads -Force | Out-Null
    Expand-Archive -LiteralPath $archivePieces.FullName -DestinationPath $cibleUploads -Force
  }

  Write-Host "Restauration terminée depuis : $source"
} finally {
  Pop-Location
}
