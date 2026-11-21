# Builds a real per-user Windows setup .exe from the privacy-scanned Leaf binary.
# Uses the Windows PowerShell 5.1 / .NET Framework C# compiler already in Windows.
# It never downloads tools, installs software on the runner, or executes the installation.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Application,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Windows PowerShell 5.1 is required for the built-in C# compiler.' }
$app = (Resolve-Path -LiteralPath $Application -ErrorAction Stop).ProviderPath
if ([IO.Path]::GetFileName($app) -ne 'leaf-desktop.exe') { throw 'Expected exact Leaf release executable.' }
if ((Get-Item -LiteralPath $app).Length -lt 1024) { throw 'Application binary is missing or truncated.' }
$hash = (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceFile = Join-Path $PSScriptRoot 'windows-installer.cs'
$source = [IO.File]::ReadAllText($sourceFile).Replace('__PAYLOAD_SHA256__', $hash)
if ($source -notlike "*$hash*") { throw 'SHA-256 insertion failed.' }
$outputPath = [IO.Path]::GetFullPath($Output)
$outDir = [IO.Path]::GetDirectoryName($outputPath)
[IO.Directory]::CreateDirectory($outDir) | Out-Null
$provider = New-Object Microsoft.CSharp.CSharpCodeProvider
$parameters = New-Object System.CodeDom.Compiler.CompilerParameters
$parameters.GenerateExecutable = $true
$parameters.GenerateInMemory = $false
$parameters.IncludeDebugInformation = $false
$parameters.OutputAssembly = $outputPath
$parameters.CompilerOptions = '/target:winexe /platform:x64 /optimize+ /debug- /resource:"' + $app + '",LeafPayload'
foreach ($assembly in @('System.dll', 'System.Core.dll', 'System.Windows.Forms.dll')) { [void]$parameters.ReferencedAssemblies.Add($assembly) }
$result = $provider.CompileAssemblyFromSource($parameters, $source)
if ($result.Errors.HasErrors) {
  # Diagnostics may include full local machine paths: retain them ONLY in the runner's local temp.
  if ($env:RUNNER_TEMP) {
    $details = Join-Path $env:RUNNER_TEMP 'leaf-setup-compilation.log'
    [IO.File]::WriteAllLines($details, [string[]]@($result.Errors | ForEach-Object { $_.ToString() }))
  }
  throw 'Embedded Windows setup compilation failed. Local diagnostics were not published.'
}
if (-not [IO.File]::Exists($outputPath)) { throw 'Windows installer was not generated.' }
$process = Start-Process -FilePath $outputPath -ArgumentList '/verify' -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Embedded installer payload SHA-256 verification failed.' }
Write-Output 'Unsigned Windows setup compiled and embedded payload verified without installing anything on the runner.'
