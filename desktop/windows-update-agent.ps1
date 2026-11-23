# Leaf unsigned Windows update helper. Embedded in the compiled desktop EXE.
# No arbitrary URLs, commands or package paths are accepted from the WebView.
param(
  [Parameter(Mandatory=$true)][ValidateSet('Check','Download','Apply','SelfTest')][string]$Mode,
  [string]$CurrentTag = 'v1.11.0-lgg.1-windows-rc.1',
  [string]$Tag = '',
  [ValidateSet('portable','installed')][string]$AppMode = 'portable',
  [string]$CacheFolder = '',
  [int]$WaitPid = 0,
  [string]$Package = '',
  [string]$ExpectedSha = '',
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$maxAssetSize = 104857600 # 100 MB
$maxApiSize = 2097152
function Fail([string]$message) { throw $message }
function GetVersion([string]$value) {
  if ($value -notmatch '^v([0-9]+)\.([0-9]+)\.([0-9]+)-lgg\.([0-9]+)(?:-windows-rc\.([0-9]+))?$') { return $null }
  $stable = if ($matches[5]) { 0 } else { 1 }
  $rc = if ($matches[5]) { [long]$matches[5] } else { 0 }
  return @([long]$matches[1],[long]$matches[2],[long]$matches[3],[long]$matches[4],[long]$stable,[long]$rc)
}
function CompareVersion($a, $b) {
  for ($i=0; $i -lt 6; $i++) {
    if ($a[$i] -gt $b[$i]) { return 1 }
    if ($a[$i] -lt $b[$i]) { return -1 }
  }
  return 0
}
function Sha256([string]$file) {
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
function FileNameForMode([string]$mode) {
  if ($mode -eq 'installed') { return 'Leaf-Windows-10-11-x64-Setup.exe' }
  return 'Leaf-Windows-10-11-x64-Portable.zip'
}
function NewHttpClient {
  Add-Type -AssemblyName System.Net.Http
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $true
  $handler.MaxAutomaticRedirections = 4
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(45)
  [void]$client.DefaultRequestHeaders.UserAgent.ParseAdd('Leaf-desktop-updater/1')
  [void]$client.DefaultRequestHeaders.Accept.ParseAdd('application/vnd.github+json')
  return $client
}
function ReadBounded($response, [int]$limit) {
  $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $memory = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 32768
  try {
    while (($n = $stream.Read($buffer,0,$buffer.Length)) -gt 0) {
      if ($memory.Length + $n -gt $limit) { Fail 'GitHub metadata exceeded its maximum size.' }
      $memory.Write($buffer,0,$n)
    }
    return [Text.Encoding]::UTF8.GetString($memory.ToArray())
  } finally { $memory.Dispose(); $stream.Dispose() }
}
function TrustedReleases([System.Net.Http.HttpClient]$client, [string]$current, [string]$mode) {
  $currentVersion = GetVersion $current
  if ($null -eq $currentVersion) { Fail 'Current Leaf version is invalid.' }
  $uri = 'https://api.github.com/repos/lgg/leaf/releases?per_page=40'
  $response = $client.GetAsync($uri,[System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  try {
    if (-not $response.IsSuccessStatusCode) { Fail 'GitHub Releases cannot be checked.' }
    $raw = ReadBounded $response $maxApiSize
    $releases = ConvertFrom-Json -InputObject $raw
  } finally { $response.Dispose() }
  $latest = $null
  $latestVer = $currentVersion
  $fileName = FileNameForMode $mode
  foreach ($rel in @($releases)) {
    if ($rel.draft) { continue }
    $candidate = [string]$rel.tag_name
    $version = GetVersion $candidate
    if ($null -eq $version -or (CompareVersion $version $latestVer) -le 0) { continue }
    $expectedUrl = 'https://github.com/lgg/leaf/releases/download/' + $candidate + '/' + $fileName
    $asset = @($rel.assets | Where-Object { $_.name -ceq $fileName -and $_.browser_download_url -ceq $expectedUrl })
    if ($asset.Count -ne 1) { continue }
    $entry = $asset[0]
    $digest = [string]$entry.digest
    $shaMatch = [regex]::Match($digest,'^sha256:([a-fA-F0-9]{64})$')
    if (-not $shaMatch.Success) { continue }
    if ([long]$entry.size -lt 1024 -or [long]$entry.size -gt $maxAssetSize) { continue }
    $latest = [ordered]@{
      tag = $candidate
      currentTag = $current
      notes = ([string]$rel.body).Substring(0,[Math]::Min(([string]$rel.body).Length,5000))
      releaseUrl = 'https://github.com/lgg/leaf/releases/tag/' + $candidate
      mode = $mode
      assetName = $fileName
      bytes = [long]$entry.size
      sha256 = $shaMatch.Groups[1].Value.ToLowerInvariant()
      assetUrl = $expectedUrl
    }
    $latestVer = $version
  }
  return $latest
}
function DownloadAsset([System.Net.Http.HttpClient]$client, [string]$url, [string]$output, [string]$hash, [long]$expectedSize) {
  $response = $client.GetAsync($url,[System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  try {
    if (-not $response.IsSuccessStatusCode) { Fail 'GitHub release download failed.' }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $file = [IO.File]::Open($output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $hasher = [Security.Cryptography.SHA256]::Create()
    $buf = New-Object byte[] 65536
    $total = 0L
    try {
      while (($n = $stream.Read($buf,0,$buf.Length)) -gt 0) {
        $total += $n
        if ($total -gt $maxAssetSize) { Fail 'Downloaded asset exceeded its maximum size.' }
        $file.Write($buf,0,$n)
        [void]$hasher.TransformBlock($buf,0,$n,$buf,0)
      }
      [void]$hasher.TransformFinalBlock((New-Object byte[] 0),0,0)
      $file.Flush($true)
      $digest = [BitConverter]::ToString($hasher.Hash).Replace('-','').ToLowerInvariant()
      if ($total -ne $expectedSize -or $digest -ne $hash) {
        Fail 'Downloaded file did not match GitHub SHA-256 and size.'
      }
    } finally { $hasher.Dispose(); $file.Dispose(); $stream.Dispose() }
  } finally { $response.Dispose() }
}
if ($Mode -eq 'SelfTest') {
  $prev = @(GetVersion 'v1.10.2-lgg.1-windows-rc.1')
  $next = @(GetVersion 'v1.10.3-lgg.1-windows-rc.1')
  $stable = @(GetVersion 'v1.10.3-lgg.1')
  if ($prev.Count -ne 6 -or $next.Count -ne 6 -or $stable.Count -ne 6) { Fail 'Version parser returned invalid tuples.' }
  if ((CompareVersion $next $prev) -ne 1 -or (CompareVersion $stable $next) -ne 1) { Fail 'GitHub version comparison failed.' }
  # Exercise the exact user-facing Portable upgrade from the existing
  # v1.10.5 candidate to the requested v1.11.0 release.
  $portablePrevious = @(GetVersion 'v1.10.5-lgg.1-windows-rc.1')
  $portableNext = @(GetVersion 'v1.11.0-lgg.1-windows-rc.1')
  if ($portablePrevious.Count -ne 6 -or $portableNext.Count -ne 6 -or
      (CompareVersion $portableNext $portablePrevious) -ne 1) {
    Fail 'Portable 1.10.5 -> 1.11.0 update comparison failed.'
  }
  if ($null -ne (GetVersion 'v1.10.3-lgg.1-evil/../../')) { Fail 'Untrusted version passed parser.' }
  if ((FileNameForMode 'portable') -cne 'Leaf-Windows-10-11-x64-Portable.zip') { Fail 'Portable asset mismatch.' }
  if ((FileNameForMode 'installed') -cne 'Leaf-Windows-10-11-x64-Setup.exe') { Fail 'Installed asset mismatch.' }
  Write-Output 'Updater self-tests passed.'
  exit 0
}
if ($Mode -eq 'Check' -or $Mode -eq 'Download') {
  if ((GetVersion $CurrentTag) -eq $null) { Fail 'Leaf update version cannot be parsed.' }
  $client = NewHttpClient
  try {
    $item = TrustedReleases $client $CurrentTag $AppMode
    if ($Mode -eq 'Check') {
      if ($null -eq $item) { Write-Output 'null' }
      else {
        # Never give a network-supplied URL or SHA as trusted command arguments
        # to the renderer. Only the authoritative native agent uses those.
        $public = @{tag=$item.tag;currentTag=$item.currentTag;notes=$item.notes;releaseUrl=$item.releaseUrl;mode=$item.mode;bytes=$item.bytes}
        Write-Output (ConvertTo-Json -InputObject $public -Compress -Depth 5)
      }
      exit 0
    }
    if ($null -eq $item -or $item.tag -cne $Tag) { Fail 'Requested release changed; check for updates again.' }
    if (-not $CacheFolder -or -not [IO.Path]::IsPathRooted($CacheFolder)) { Fail 'Invalid update cache location.' }
    [void][IO.Directory]::CreateDirectory($CacheFolder)
    $final = Join-Path $CacheFolder $item.assetName
    $temp = Join-Path $CacheFolder ('.leaf-download-' + [Guid]::NewGuid().ToString('N'))
    try {
      if (-not (Test-Path -LiteralPath $final -PathType Leaf) -or (Sha256 $final) -ne $item.sha256) {
        DownloadAsset $client $item.assetUrl $temp $item.sha256 $item.bytes
        if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Force }
        Move-Item -LiteralPath $temp -Destination $final
      }
      if ((Sha256 $final) -ne $item.sha256) { Fail 'Cached update hash mismatch.' }
      Write-Output (ConvertTo-Json -InputObject @{tag=$item.tag;mode=$item.mode;path=$final;sha256=$item.sha256;bytes=$item.bytes} -Compress)
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
  } finally { $client.Dispose() }
  exit 0
}
# Apply always executes as a separate process AFTER Leaf has confirmed saving
# recovery drafts and called its native close path.
if ($Mode -eq 'Apply') {
  if ($WaitPid -le 0 -or -not $Package -or -not $Target -or $ExpectedSha -notmatch '^[0-9a-f]{64}$') { Fail 'Invalid update handoff.' }
  $failure = Join-Path ([IO.Path]::GetDirectoryName($Package)) 'update-error.log'
  try {
    Wait-Process -Id $WaitPid -Timeout 120 -ErrorAction SilentlyContinue
    if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Fail 'Leaf did not exit before updating.' }
    if (-not (Test-Path -LiteralPath $Package -PathType Leaf) -or (Sha256 $Package) -ne $ExpectedSha) { Fail 'Update package hash changed before installation.' }
    if ($AppMode -eq 'installed') {
      if ([IO.Path]::GetFileName($Package) -cne 'Leaf-Windows-10-11-x64-Setup.exe') { Fail 'Unexpected Setup filename.' }
      Start-Process -FilePath $Package | Out-Null
    } else {
      if ([IO.Path]::GetFileName($Package) -cne 'Leaf-Windows-10-11-x64-Portable.zip') { Fail 'Unexpected portable filename.' }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $archive = [IO.Compression.ZipFile]::OpenRead($Package)
      $staged = Join-Path ([IO.Path]::GetDirectoryName($Target)) ('.leaf-update-' + [Guid]::NewGuid().ToString('N') + '.exe')
      $backup = Join-Path ([IO.Path]::GetDirectoryName($Target)) ('.leaf-backup-' + [Guid]::NewGuid().ToString('N') + '.exe')
      try {
        if ($archive.Entries.Count -ne 1 -or $archive.Entries[0].FullName -cne 'leaf-desktop.exe') { Fail 'Portable archive has unexpected contents.' }
        $entry = $archive.Entries[0]
        if ($entry.Length -lt 1024 -or $entry.Length -gt $maxAssetSize) { Fail 'Portable executable has invalid size.' }
        $source = $entry.Open()
        $dest = [IO.File]::Open($staged,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $source.CopyTo($dest); $dest.Flush($true) } finally { $source.Dispose(); $dest.Dispose() }
        if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { Fail 'Original portable EXE is missing.' }
        [IO.File]::Replace($staged,$Target,$backup,$true)
        Start-Process -FilePath $Target | Out-Null
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
      } finally {
        $archive.Dispose()
        if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }
        # A failed restart leaves the backup for manual recovery.
      }
    }
    if (Test-Path -LiteralPath $failure) { Remove-Item -LiteralPath $failure -Force -ErrorAction SilentlyContinue }
  } catch {
    # Local error log only: do not publish user paths or file contents.
    [IO.File]::WriteAllText($failure,'Update failed. Leaf files were not intentionally erased. Please retry via GitHub Releases.')
    exit 1
  }
  exit 0
}
