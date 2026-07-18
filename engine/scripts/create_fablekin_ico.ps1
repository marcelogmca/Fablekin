param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePng,

    [Parameter(Mandatory = $true)]
    [string]$OutputIco
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-ScaledBitmap {
    param(
        [string]$Source,
        [int]$Size
    )

    $srcImg = [System.Drawing.Image]::FromFile($Source)
    try {
        $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

            $scale = [Math]::Min($Size / $srcImg.Width, $Size / $srcImg.Height)
            $w = [int][Math]::Round($srcImg.Width * $scale)
            $h = [int][Math]::Round($srcImg.Height * $scale)
            $x = [int](($Size - $w) / 2)
            $y = [int](($Size - $h) / 2)

            $g.DrawImage($srcImg, $x, $y, $w, $h)
        } finally {
            $g.Dispose()
        }

        return $bmp
    } catch {
        if ($bmp) { $bmp.Dispose() }
        throw
    } finally {
        $srcImg.Dispose()
    }
}

function New-DibIconFrame {
    param(
        [string]$Source,
        [int]$Size
    )

    $bmp = New-ScaledBitmap -Source $Source -Size $Size
    try {
        $pixelBytes = [byte[]]::new($Size * $Size * 4)
        $index = 0

        # ICO DIB pixels are stored bottom-up in BGRA order.
        for ($y = $Size - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $Size; $x++) {
                $pixel = $bmp.GetPixel($x, $y)
                $pixelBytes[$index++] = $pixel.B
                $pixelBytes[$index++] = $pixel.G
                $pixelBytes[$index++] = $pixel.R
                $pixelBytes[$index++] = $pixel.A
            }
        }

        $maskStride = [int]([Math]::Ceiling($Size / 32) * 4)
        $andMask = [byte[]]::new($maskStride * $Size)
        $ms = [System.IO.MemoryStream]::new()
        $bw = [System.IO.BinaryWriter]::new($ms)

        try {
            $bw.Write([UInt32]40)           # BITMAPINFOHEADER size
            $bw.Write([Int32]$Size)
            $bw.Write([Int32]($Size * 2))   # XOR bitmap height + AND mask height
            $bw.Write([UInt16]1)
            $bw.Write([UInt16]32)
            $bw.Write([UInt32]0)            # BI_RGB
            $bw.Write([UInt32]$pixelBytes.Length)
            $bw.Write([Int32]0)
            $bw.Write([Int32]0)
            $bw.Write([UInt32]0)
            $bw.Write([UInt32]0)
            $bw.Write($pixelBytes)
            $bw.Write($andMask)
            $bw.Flush()
            return ,([byte[]]$ms.ToArray())
        } finally {
            $bw.Dispose()
            $ms.Dispose()
        }
    } finally {
        $bmp.Dispose()
    }
}

function New-PngIconFrame {
    param(
        [string]$Source,
        [int]$Size
    )

    $bmp = New-ScaledBitmap -Source $Source -Size $Size
    try {
        $ms = [System.IO.MemoryStream]::new()
        try {
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            return ,([byte[]]$ms.ToArray())
        } finally {
            $ms.Dispose()
        }
    } finally {
        $bmp.Dispose()
    }
}

$frames = @(
    [pscustomobject]@{ Size = 16; Bytes = [byte[]](New-DibIconFrame -Source $SourcePng -Size 16) },
    [pscustomobject]@{ Size = 32; Bytes = [byte[]](New-DibIconFrame -Source $SourcePng -Size 32) },
    [pscustomobject]@{ Size = 48; Bytes = [byte[]](New-DibIconFrame -Source $SourcePng -Size 48) },
    [pscustomobject]@{ Size = 256; Bytes = [byte[]](New-PngIconFrame -Source $SourcePng -Size 256) }
)

$fs = [System.IO.File]::Open($OutputIco, [System.IO.FileMode]::Create)
$bw = [System.IO.BinaryWriter]::new($fs)

try {
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$frames.Count)

    $offset = 6 + (16 * $frames.Count)
    foreach ($frame in $frames) {
        $dimension = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
        $bw.Write([byte]$dimension)
        $bw.Write([byte]$dimension)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([UInt16]1)
        $bw.Write([UInt16]32)
        $bw.Write([UInt32]$frame.Bytes.Length)
        $bw.Write([UInt32]$offset)
        $offset += $frame.Bytes.Length
    }

    foreach ($frame in $frames) {
        $bw.Write([byte[]]$frame.Bytes)
    }
} finally {
    $bw.Dispose()
    $fs.Dispose()
}
