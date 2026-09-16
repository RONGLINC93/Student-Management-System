$ErrorActionPreference = 'Stop'

$path = 'd:\Desktop\developing\Student-Management-System\打包全部.bat'
$bytes = [System.IO.File]::ReadAllBytes($path)
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
}

$text = [System.Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n"
$old = 'echo Closing in %~1 seconds... (Ctrl+C to cancel)'
$new = 'echo 将在 %~1 秒后关闭... (Ctrl+C 可取消)'

if (-not $text.Contains($old)) {
    Write-Host "  [SKIP] old line not found"
    exit 0
}
$text2 = $text.Replace($old, $new)
$crlf = ($text2 -split "`n") -join "`r`n"
[System.IO.File]::WriteAllText($path, $crlf, [System.Text.Encoding]::UTF8)
Write-Host "  [DONE] replaced line, BOM-check below"

# 确认无 BOM
$bytes2 = [System.IO.File]::ReadAllBytes($path)
if ($bytes2[0] -eq 0xEF -and $bytes2[1] -eq 0xBB -and $bytes2[2] -eq 0xBF) {
    Write-Host "  [WARN] file still has BOM, stripping..."
    [System.IO.File]::WriteAllBytes($path, $bytes2[3..($bytes2.Length-1)])
}
Write-Host "  [OK] file written"