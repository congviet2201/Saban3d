Add-Type -AssemblyName System.Drawing
$out = "C:\Users\playz\AppData\Local\Temp\opencode\tav_grid"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$src = "D:\Projects\Work\TAV 360 imageset layering\261002_SEQUENCE"

# crop region in full-res coordinates
$x0 = 850; $y0 = 120; $x1 = 3200; $y1 = 1600
$cw = $x1 - $x0; $ch = $y1 - $y0
$scale = 0.667
$w = [int]($cw * $scale); $h = [int]($ch * $scale)

$fonts = New-Object System.Drawing.Font("Arial", 11, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::Red
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 255, 0, 0), 1)
$penMinor = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 0, 120, 255), 1)

foreach ($n in 0,15,30,45,60,75,90,105) {
  $f = Join-Path $src ("10000000" + $n.ToString() + ".png") # placeholder fixed below
  $f = Join-Path $src ((10000000 + $n).ToString() + ".png")
  $img = [System.Drawing.Image]::FromFile($f)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$w,$h)), (New-Object System.Drawing.Rectangle($x0,$y0,$cw,$ch)), [System.Drawing.GraphicsUnit]::Pixel)

  # vertical lines every 200 full px
  for ($x = [Math]::Ceiling($x0/200)*200; $x -lt $x1; $x += 100) {
    $px = [int](($x - $x0) * $scale)
    if ($x % 200 -eq 0) { $g.DrawLine($pen, $px, 0, $px, $h); $g.DrawString("$x", $fonts, $brush, $px + 2, 2) }
    else { $g.DrawLine($penMinor, $px, 0, $px, $h) }
  }
  for ($y = [Math]::Ceiling($y0/200)*200; $y -lt $y1; $y += 100) {
    $py = [int](($y - $y0) * $scale)
    if ($y % 200 -eq 0) { $g.DrawLine($pen, 0, $py, $w, $py); $g.DrawString("$y", $fonts, $brush, 2, $py + 2) }
    else { $g.DrawLine($penMinor, 0, $py, $w, $py) }
  }
  $op = Join-Path $out ("grid_" + $n.ToString("000") + ".jpg")
  $bmp.Save($op, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  Write-Output $op
}
