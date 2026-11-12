# PowerShell sample for Treelights tests.
param([string]$Target = "10.0.0.1", [int[]]$Ports = @(22, 80, 443))

function Test-Port {
    param($HostName, $Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect($HostName, $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

foreach ($p in $Ports) {
    if (Test-Port -HostName $Target -Port $p) { Write-Host "open: $p" -ForegroundColor Green }
}
Get-Process | Where-Object { $_.CPU -gt 100 } | Sort-Object CPU -Descending
