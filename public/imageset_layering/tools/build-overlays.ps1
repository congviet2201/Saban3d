# Chuyen mask JPEG (nÃªn Ä‘en, vÃ¹ng tÃ´ mÃ u) -> PNG trong suá»‘t Ä‘Ã£ tÃ´ lÃ´ng theo báº£ng mÃ u táº§ng.
# Káº¿t quáº£: overlays/f1/000.png ... overlays/f4/119.png
# Cháº¡y:  powershell -ExecutionPolicy Bypass -File tools\build-overlays.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot          # thÆ° má»¥c dá»± Ã¡n
$maskDir = Join-Path $root 'mask'
$outRoot = Join-Path $root 'overlays'

$code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class MaskConv {
    public static void Convert(string src, string dst, int r, int g, int b, int threshold) {
        using (var img = new Bitmap(src))
        using (var outImg = new Bitmap(img.Width, img.Height, PixelFormat.Format32bppArgb)) {
            var rect = new Rectangle(0, 0, img.Width, img.Height);
            var d = img.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            var o = outImg.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            int db = Math.Abs(d.Stride) * img.Height;
            byte[] buf = new byte[db];
            Marshal.Copy(d.Scan0, buf, 0, db);
            int ob = Math.Abs(o.Stride) * img.Height;
            byte[] outb = new byte[ob];
            for (int y = 0; y < img.Height; y++) {
                int drow = y * d.Stride, orow = y * o.Stride;
                for (int x = 0; x < img.Width; x++) {
                    int i = drow + x * 3;
                    byte bb = buf[i], gg = buf[i + 1], rr = buf[i + 2];
                    int mx = Math.Max(rr, Math.Max(gg, bb));
                    int oi = orow + x * 4;
                    if (mx > threshold) {
                        outb[oi] = (byte)b; outb[oi + 1] = (byte)g; outb[oi + 2] = (byte)r; outb[oi + 3] = 255;
                    } else {
                        outb[oi + 3] = 0;
                    }
                }
            }
            Marshal.Copy(outb, 0, o.Scan0, ob);
            img.UnlockBits(d);
            outImg.UnlockBits(o);
            outImg.Save(dst, ImageFormat.Png);
        }
    }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

# Báº£ng mÃ u kiáº¿n trÃºc (dá»‹u, chuyÃªn nghiá»‡p) cho 4 táº§ng
$floors = @(
    @{ folder = 'f1'; prefix = '1_CMasking_TANG0';    r = 0x5B; g = 0x8D; b = 0xEF },
    @{ folder = 'f2'; prefix = '1_CMasking_TANG1';    r = 0x2F; g = 0xB9; b = 0x8C },
    @{ folder = 'f3'; prefix = '1_CMasking_TANG2';    r = 0xE0; g = 0xA9; b = 0x3F },
    @{ folder = 'f4'; prefix = '1_CMasking_TANGTUM';  r = 0xE1; g = 0x70; b = 0x8A }
)

$count = 120
$threshold = 40
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$total = 0

foreach ($fl in $floors) {
    $outDir = Join-Path $outRoot $fl.folder
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    for ($i = 0; $i -lt $count; $i++) {
        $src = Join-Path $maskDir ($fl.prefix + ('{0:0000}' -f $i) + '.jpg')
        if (-not (Test-Path $src)) { Write-Warning "Thieu mask: $src"; continue }
        $dst = Join-Path $outDir ($i.ToString('000') + '.png')
        [MaskConv]::Convert($src, $dst, [int]$fl.r, [int]$fl.g, [int]$fl.b, $threshold)
        $total++
    }
    Write-Progress -Activity 'Tao lop mask' -Status "$($fl.folder)" -PercentComplete 100
}

$sw.Stop()
Write-Host ("Hoan tat {0} PNG trong {1:N1} giay -> {2}" -f $total, $sw.Elapsed.TotalSeconds, $outRoot)
