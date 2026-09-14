$ErrorActionPreference = 'Stop'

$ffmpeg = 'C:\Users\USER\AppData\Local\Programs\recordly\resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe'
$root = $PSScriptRoot
$scenes = Join-Path $root 'scenes'
$clips = Join-Path $root 'clips'
$durations = @(5, 5, 8, 10, 10, 6, 5, 5, 4)

New-Item -ItemType Directory -Path $clips -Force | Out-Null

for ($index = 0; $index -lt $durations.Count; $index += 1) {
  $number = $index + 1
  $duration = $durations[$index]
  $frames = $duration * 30
  $fadeOut = $duration - 0.2
  $input = Join-Path $scenes ('scene-{0:D2}.png' -f $number)
  $output = Join-Path $clips ('clip-{0:D2}.mp4' -f $number)
  $filter = "scale=2048:1152,zoompan=z='min(zoom+0.00018,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOut}:d=0.18,format=yuv420p"
  & $ffmpeg -y -hide_banner -loglevel error -loop 1 -i $input -vf $filter -t $duration -an -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p $output
  if ($LASTEXITCODE -ne 0) { throw "Scene $number failed to render." }
}

$concatPath = Join-Path $clips 'concat.txt'
$concatLines = 1..$durations.Count | ForEach-Object { "file 'clip-{0:D2}.mp4'" -f $_ }
# Windows PowerShell 5 writes a BOM for -Encoding utf8; FFmpeg treats that
# prefix as part of the first concat directive. ASCII is sufficient here.
Set-Content -LiteralPath $concatPath -Value $concatLines -Encoding ascii

$silent = Join-Path $root 'docket-demo-silent.mp4'
& $ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i $concatPath -c copy $silent
if ($LASTEXITCODE -ne 0) { throw 'Silent master failed to concatenate.' }

$voiceover = Join-Path $root 'voiceover.wav'
$master = Join-Path $root 'Docket-Agent-Tank-demo-1080p.mp4'
$audioFilter = "[1:a]aresample=48000,volume=1.0[vo];[2:a]volume=0.012[low];[3:a]volume=0.006[high];[low][high]amix=inputs=2:duration=longest,afade=t=in:st=0:d=2,afade=t=out:st=56:d=2[bed];[vo][bed]amix=inputs=2:duration=longest:normalize=0[aout]"
& $ffmpeg -y -hide_banner -loglevel error -i $silent -i $voiceover -f lavfi -i 'sine=frequency=110:sample_rate=48000:duration=58' -f lavfi -i 'sine=frequency=165:sample_rate=48000:duration=58' -filter_complex $audioFilter -map 0:v:0 -map '[aout]' -t 58 -c:v copy -c:a aac -b:a 192k -movflags +faststart $master
if ($LASTEXITCODE -ne 0) { throw 'Master audio mux failed.' }

Write-Output $master
