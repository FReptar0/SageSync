<#
.SYNOPSIS
    Registers SageSync as a Windows Service via Servy.

.DESCRIPTION
    Idempotent PowerShell script that installs SageSync as a native Windows Service
    using Servy CLI. Safe to run multiple times -- checks if service already exists
    before registering.

    Servy manages: auto-start on boot, restart on crash, log rotation, health monitoring.

.PARAMETER InstallDir
    Directory where SageSync is deployed. Default: E:\SageSync

.PARAMETER NodePath
    Path to node.exe. Default: C:\Program Files\nodejs\node.exe

.PARAMETER ServiceName
    Windows Service name. Default: SageSync

.PARAMETER Port
    Port the service listens on. Default: 3000

.EXAMPLE
    .\install-service.ps1
    Installs with all defaults (E:\SageSync, SageSync, port 3000).

.EXAMPLE
    .\install-service.ps1 -InstallDir "D:\apps\SageSync" -Port 3001
    Installs with custom directory and port.
#>

param(
    [string]$InstallDir = "E:\SageSync",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$ServiceName = "SageSync",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

# 1. Verify running as Administrator (Servy requires elevated privileges)
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Este script requiere permisos de Administrador." -ForegroundColor Red
    Write-Host "        Ejecute PowerShell como Administrador e intente de nuevo." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Ejecutando como Administrador" -ForegroundColor Green

# 2. Check if servy-cli is available on PATH
$servyCli = Get-Command "servy-cli" -ErrorAction SilentlyContinue
if (-not $servyCli) {
    Write-Host "[ERROR] servy-cli no se encontro en el PATH." -ForegroundColor Red
    Write-Host "        Instale Servy con: winget install servy" -ForegroundColor Yellow
    Write-Host "        Despues reinicie la terminal y ejecute este script de nuevo." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] servy-cli encontrado: $($servyCli.Source)" -ForegroundColor Green

# 3. Check if Node.js exists at the specified path
if (-not (Test-Path $NodePath)) {
    Write-Host "[ERROR] Node.js no encontrado en: $NodePath" -ForegroundColor Red
    Write-Host "        Verifique la ruta o use el parametro -NodePath." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Node.js encontrado: $NodePath" -ForegroundColor Green

# 4. Check if install directory exists and contains src/main.js
if (-not (Test-Path $InstallDir)) {
    Write-Host "[ERROR] Directorio de instalacion no existe: $InstallDir" -ForegroundColor Red
    Write-Host "        Despliegue el codigo primero o use el parametro -InstallDir." -ForegroundColor Yellow
    exit 1
}

$entryPoint = Join-Path $InstallDir "src\main.js"
if (-not (Test-Path $entryPoint)) {
    Write-Host "[ERROR] No se encontro src/main.js en: $InstallDir" -ForegroundColor Red
    Write-Host "        Verifique que el codigo esta desplegado correctamente." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Directorio de instalacion verificado: $InstallDir" -ForegroundColor Green

# 5. Check if service already exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host ""
    Write-Host "[INFO] El servicio '$ServiceName' ya existe." -ForegroundColor Cyan
    Write-Host "       Estado actual: $($existingService.Status)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "       Para reinstalar, primero desinstale con:" -ForegroundColor Yellow
    Write-Host "       servy-cli uninstall --name=$ServiceName" -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------------------
# Create logs directory if it does not exist
# ---------------------------------------------------------------------------
$logsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    Write-Host "[OK] Directorio de logs creado: $logsDir" -ForegroundColor Green
} else {
    Write-Host "[OK] Directorio de logs existe: $logsDir" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Install service via Servy CLI
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Instalando servicio '$ServiceName' via Servy..." -ForegroundColor Cyan
Write-Host ""

$stdoutLog = Join-Path $InstallDir "logs\servy-stdout.log"
$stderrLog = Join-Path $InstallDir "logs\servy-stderr.log"

servy-cli install `
    --name="$ServiceName" `
    --displayName="SageSync" `
    --description="Sage 300 - Fracttal inventory synchronization service" `
    --path="$NodePath" `
    --params="src/main.js" `
    --startupDir="$InstallDir" `
    --startupType="Automatic" `
    --stdout="$stdoutLog" `
    --stderr="$stderrLog" `
    --enableHealth `
    --heartbeatInterval=30 `
    --maxFailedChecks=3 `
    --recoveryAction="RestartService" `
    --maxRestartAttempts=5 `
    --enableSizeRotation `
    --rotationSize=10 `
    --maxRotations=5 `
    --stopTimeout=30

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Fallo la instalacion del servicio. Codigo de salida: $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Servicio instalado exitosamente." -ForegroundColor Green

# ---------------------------------------------------------------------------
# Start the service and verify
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Iniciando servicio '$ServiceName'..." -ForegroundColor Cyan

Start-Service -Name $ServiceName -ErrorAction Stop
Start-Sleep -Seconds 3

$service = Get-Service -Name $ServiceName
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " Servicio '$ServiceName' esta corriendo " -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Estado:      $($service.Status)" -ForegroundColor White
    Write-Host "  Tipo inicio: Automatic" -ForegroundColor White
    Write-Host "  Logs stdout: $stdoutLog" -ForegroundColor White
    Write-Host "  Logs stderr: $stderrLog" -ForegroundColor White
    Write-Host "  Dashboard:   http://localhost:$Port" -ForegroundColor White
    Write-Host "  License:     http://localhost:$Port/api/system/license" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "[WARN] El servicio fue instalado pero su estado es: $($service.Status)" -ForegroundColor Yellow
    Write-Host "       Revise los logs en: $stderrLog" -ForegroundColor Yellow
}

exit 0
