using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Leaf desktop Windows installer")]
[assembly: AssemblyDescription("Leaf desktop user-scoped installer (Windows 10 and 11, x64)")]
[assembly: AssemblyVersion("1.10.0.0")]

internal static class LeafWindowsSetup
{
    private const string PayloadName = "LeafPayload";
    private const string ExpectedSha256 = "__PAYLOAD_SHA256__";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Leaf";
    private const string UninstallScript = @"$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\Leaf'
$exe = Join-Path $dir 'leaf-desktop.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Leaf.lnk'
if (Test-Path -LiteralPath $exe -PathType Leaf) { Remove-Item -LiteralPath $exe -Force }
if (Test-Path -LiteralPath $startMenu) { Remove-Item -LiteralPath $startMenu -Force }
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Leaf'
if (Test-Path -LiteralPath $registry) { Remove-Item -LiteralPath $registry -Recurse -Force }
Remove-Item -LiteralPath (Join-Path $dir 'uninstall-leaf.ps1') -Force
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue }
";
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "/verify")
            return VerifyPayload() ? 0 : 2;
        if (args.Length != 0) return 3;
        if (!Environment.Is64BitOperatingSystem)
        {
            MessageBox.Show("Leaf requires a 64-bit Windows 10 or Windows 11 installation.", "Leaf Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 4;
        }
        DialogResult choice = MessageBox.Show(
            "Install Leaf desktop for this Windows user?\r\n\r\n" +
            "Leaf will be installed inside your local application data. No administrator rights are needed. " +
            "The app is unsigned and uses the Microsoft Edge WebView2 runtime.\r\n\r\n" +
            "Your existing Markdown files will not be changed by the installer.",
            "Leaf desktop setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (choice != DialogResult.Yes) return 0;
        if (!VerifyPayload())
        {
            MessageBox.Show("The embedded Leaf executable did not pass its SHA-256 integrity check.", "Leaf Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 5;
        }
        try
        {
            Install();
            MessageBox.Show("Leaf installed successfully. Open it from the Start menu.\r\n\r\n" +
                "You can uninstall it from Windows Apps & features.", "Leaf Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch
        {
            MessageBox.Show("Leaf setup could not finish. Close any running Leaf window and try again. " +
                "Your personal Markdown documents have not been modified by the installer.",
                "Leaf Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 6;
        }
    }
    private static bool VerifyPayload()
    {
        try
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadName))
            using (SHA256 sha = SHA256.Create())
            {
                if (stream == null || stream.Length < 1024) return false;
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return string.Equals(sb.ToString(), ExpectedSha256, StringComparison.Ordinal);
            }
        }
        catch { return false; }
    }
    private static void Install()
    {
        string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Leaf");
        if (string.IsNullOrWhiteSpace(folder)) throw new IOException("No local application data directory");
        Directory.CreateDirectory(folder);
        string exe = Path.Combine(folder, "leaf-desktop.exe");
        string staging = Path.Combine(folder, ".leaf-new-" + Guid.NewGuid().ToString("N") + ".exe");
        string backup = Path.Combine(folder, ".leaf-backup-" + Guid.NewGuid().ToString("N") + ".exe");
        try
        {
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadName))
            using (FileStream output = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                if (payload == null) throw new IOException("Missing embedded executable");
                payload.CopyTo(output);
                output.Flush(true);
            }
            if (File.Exists(exe))
            {
                File.Replace(staging, exe, backup, true);
                if (File.Exists(backup)) File.Delete(backup);
            }
            else File.Move(staging, exe);
            string uninstall = Path.Combine(folder, "uninstall-leaf.ps1");
            File.WriteAllText(uninstall, UninstallScript, new UTF8Encoding(false));
            MakeShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Leaf.lnk"), exe);
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                if (key == null) throw new IOException("Cannot register uninstall");
                key.SetValue("DisplayName", "Leaf desktop");
                key.SetValue("DisplayVersion", "1.10.0");
                key.SetValue("Publisher", "lgg");
                key.SetValue("InstallLocation", folder);
                key.SetValue("DisplayIcon", exe);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("UninstallString", "\"powershell.exe\" -NoProfile -ExecutionPolicy Bypass -File \"" + uninstall + "\"");
            }
        }
        finally
        {
            if (File.Exists(staging)) File.Delete(staging);
        }
    }
    private static void MakeShortcut(string shortcutPath, string target)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new IOException("Windows Shell shortcut support unavailable");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = null;
        try
        {
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] {shortcutPath});
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] {target});
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] {Path.GetDirectoryName(target)});
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] {"Leaf Markdown editor"});
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, new object[0]);
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }
}
