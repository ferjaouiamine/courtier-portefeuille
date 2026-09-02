param(
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$racineProjet = Split-Path -Parent $PSScriptRoot
$horodatage = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $Destination) {
  $Destination = Join-Path $racineProjet "backups\$horodatage"
}

$destinationAbsolue = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationAbsolue -Force | Out-Null

$nomDump = "courtier-$horodatage.dump"
$dumpLocal = Join-Path $destinationAbsolue $nomDump
$dumpConteneur = "/tmp/$nomDump"

Push-Location $racineProjet
try {
  docker compose exec -T db pg_dump -U courtier -d courtier_portefeuille --format=custom --file=$dumpConteneur
  if ($LASTEXITCODE -ne 0) { throw "La sauvegarde PostgreSQL a échoué." }
  docker compose cp "db:$dumpConteneur" $dumpLocal | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "La copie du dump PostgreSQL a échoué." }
  docker compose exec -T db rm -f $dumpConteneur

  $repertoirePieces = Join-Path $racineProjet "uploads\contrats"
  $archivePieces = Join-Path $destinationAbsolue "pieces-jointes-$horodatage.zip"
  if (Test-Path -LiteralPath $repertoirePieces) {
    Compress-Archive -Path $repertoirePieces -DestinationPath $archivePieces -CompressionLevel Optimal
  }

  $empreinte = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpLocal).Hash
  $stockage = if ($env:STOCKAGE_DRIVER) { $env:STOCKAGE_DRIVER } else { "local" }
  @(
    "date=$((Get-Date).ToString('o'))"
    "dump=$nomDump"
    "sha256=$empreinte"
    "stockage=$stockage"
  ) | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $destinationAbsolue "manifest.txt")

  Write-Host "Sauvegarde créée : $destinationAbsolue"
} finally {
  Pop-Location
}
