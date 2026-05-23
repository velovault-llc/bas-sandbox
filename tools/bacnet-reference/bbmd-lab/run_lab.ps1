# Bring up the two-BBMD lab on localhost.
#
# Opens three Windows PowerShell windows:
#   1. BBMD-A on 127.0.0.1:47808, BDT peer 127.0.0.1:47809
#   2. BBMD-B on 127.0.0.1:47809, BDT peer 127.0.0.1:47808
#   3. A reader window that pauses so the user can launch Wireshark
#      and probe with whois_client.py at their pace.
#
# Run (from a regular PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\run_lab.ps1
#
# Pre-req: Wireshark on PATH (or use the explicit C:\Program Files
# path inside the reader window).

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = "py"  # python launcher; falls through to whatever python is on PATH

Write-Host "Bringing up BBMD-A on 127.0.0.1:47808..."
Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command",`
    "cd '$here'; $py bbmd_node.py --address 127.0.0.1:47808 --bbmd 127.0.0.1:47809 --instance 1801 --name BBMD-A"

Start-Sleep -Seconds 1

Write-Host "Bringing up BBMD-B on 127.0.0.1:47809..."
Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command",`
    "cd '$here'; $py bbmd_node.py --address 127.0.0.1:47809 --bbmd 127.0.0.1:47808 --instance 1802 --name BBMD-B"

Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Both BBMDs running. Probe with:"
Write-Host "  cd $here/.."
Write-Host "  python whois_client.py --target 127.0.0.1:47808"
Write-Host ""
Write-Host "Wireshark capture filter:   udp.port == 47808 or udp.port == 47809"
Write-Host "Wireshark display filter:   bvlc"
