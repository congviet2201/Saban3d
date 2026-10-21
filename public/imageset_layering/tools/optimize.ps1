# Chuyển 120 ảnh gốc 4K (3840x2160) sang JPEG 1920x1080.
# Dùng khi KHÔNG có sẵn bộ frames/*.webp (ứng dụng mặc định đọc webp).
# Kết quả ghi vào frames_jpg/ ; sau đó đổi FRAME_DIR/FRAME_EXT trong app.js.
# Chạy:  powershell -ExecutionPolicy Bypass -File tools\optimize.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root '261002_SEQUENCE'
$dst  = Join-Path $root 'frames_jpg'

New-Item -ItemType Directory -Force -Path $dst | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]82)

$count = 120
$sw = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 0; $i -lt $count; $i++) {
    $srcName = '1000' + ('{0:0000}' -f $i) + '.png'
    $srcPath = Join-Path $src $srcName
    if (-not (Test-Path $srcPath)) {
        Write-Warning "Thieu anh: $srcName"
        continue
    }

    $img = [System.Drawing.Image]::FromFile($srcPath)
    $bmp = New-Object System.Drawing.Bitmap(1920, 1080)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, 1920, 1080)
    $g.Dispose()

    $outPath = Join-Path $dst ($i.ToString('000') + '.jpg')
    $bmp.Save($outPath, $codec, $encParams)
    $bmp.Dispose()
    $img.Dispose()

    Write-Progress -Activity 'Dang toi uu anh' -Status "$($i + 1)/$count" -PercentComplete (($i + 1) / $count * 100)
}

$encParams.Dispose()
$sw.Stop()
Write-Host ("Hoan tat {0} anh trong {1:N1} giay -> {2}" -f $count, $sw.Elapsed.TotalSeconds, $dst)
