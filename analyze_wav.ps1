param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Path
)

function Get-WavInfo {
    param([Parameter(Mandatory = $true)][string]$InputPath)

    if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
        Write-Error "File not found: $InputPath"
        return
    }

    $fs = [System.IO.File]::OpenRead($InputPath)
    try {
        $br = New-Object System.IO.BinaryReader($fs)
        try {
            $riff = [System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4))
            $fileSize = $br.ReadInt32()
            $wave = [System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4))

            if ($riff -ne "RIFF" -or $wave -ne "WAVE") {
                Write-Error "Not a RIFF/WAVE file: $InputPath"
                return
            }

            $audioFormat = $null
            $channels = $null
            $sampleRate = $null
            $byteRate = $null
            $bitsPerSample = $null
            $dataSize = $null

            while ($fs.Position + 8 -le $fs.Length) {
                $chunkId = [System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4))
                $chunkSize = $br.ReadInt32()

                if ($chunkSize -lt 0 -or $fs.Position + $chunkSize -gt $fs.Length) {
                    Write-Error "Invalid WAV chunk size in: $InputPath"
                    return
                }

                if ($chunkId -eq "fmt ") {
                    $audioFormat = $br.ReadInt16()
                    $channels = $br.ReadInt16()
                    $sampleRate = $br.ReadInt32()
                    $byteRate = $br.ReadInt32()
                    $null = $br.ReadInt16() # block align
                    $bitsPerSample = $br.ReadInt16()
                    if ($chunkSize -gt 16) {
                        $null = $br.ReadBytes($chunkSize - 16)
                    }
                }
                elseif ($chunkId -eq "data") {
                    $dataSize = $chunkSize
                    $fs.Seek($chunkSize, [System.IO.SeekOrigin]::Current) | Out-Null
                }
                else {
                    $fs.Seek($chunkSize, [System.IO.SeekOrigin]::Current) | Out-Null
                }

                if (($chunkSize % 2) -ne 0 -and $fs.Position -lt $fs.Length) {
                    $fs.Seek(1, [System.IO.SeekOrigin]::Current) | Out-Null
                }
            }

            if ($null -eq $byteRate -or $byteRate -le 0 -or $null -eq $dataSize) {
                Write-Error "Required WAV chunks were not found: $InputPath"
                return
            }

            $durationSec = [math]::Round($dataSize / $byteRate, 2)
            Write-Host "=== $InputPath ==="
            Write-Host "  AudioFormat: $audioFormat (1=PCM, 3=Float)"
            Write-Host "  Channels: $channels"
            Write-Host "  SampleRate: $sampleRate Hz"
            Write-Host "  BitDepth: $bitsPerSample bit"
            Write-Host "  Duration: $durationSec sec"
            Write-Host "  DataSize: $dataSize bytes"
            Write-Host "  FileSize: $($fs.Length) bytes"
            Write-Host ""
        }
        finally {
            $br.Dispose()
        }
    }
    finally {
        $fs.Dispose()
    }
}

foreach ($item in $Path) {
    Get-WavInfo -InputPath $item
}
