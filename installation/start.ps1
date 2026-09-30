param([switch]$ConfigureOnly)
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Installez Docker Desktop (moteur Linux/WSL2). Voir INSTALLATION_LOCALE.md."
}
docker compose version
if ($LASTEXITCODE -ne 0) { throw "Docker Compose est indisponible." }
$EnvFile = Join-Path $Here ".env"
if (-not (Test-Path $EnvFile)) {
  $Bytes = New-Object byte[] 32
  $Random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Random.GetBytes($Bytes) } finally { $Random.Dispose() }
  $Password = -join ($Bytes | ForEach-Object { $_.ToString("x2") })
  $Template = [System.IO.File]::ReadAllText((Join-Path $Here ".env.example"))
  [System.IO.File]::WriteAllText($EnvFile, $Template.Replace("CHANGE_ME", $Password), (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Configuration locale creee. Ne partagez pas installation/.env."
}
if ((Get-Content $EnvFile -Raw).Contains("MONGO_PASSWORD=CHANGE_ME")) {
  throw "Remplacez CHANGE_ME par un mot de passe aleatoire dans installation/.env."
}
if ($ConfigureOnly) { Write-Host "Configuration prete. Modifiez installation/.env puis relancez sans -ConfigureOnly."; exit 0 }
docker compose --env-file $EnvFile -f (Join-Path $Here "compose.yaml") up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw "Demarrage incomplet. Consultez les logs Docker Compose." }
Write-Host "Services demarres. Suivez INSTALLATION_LOCALE.md pour le nom local et le certificat."