# 一鍵把 Antigravity 憑證設到 fly（在你自己的電腦跑，token 不會外流）。
#
# 前提：已用官方 Antigravity CLI（agy）以 Google 帳號登入過一次。
# 用法（在專案資料夾）：
#   powershell -ExecutionPolicy Bypass -File scripts\setup-antigravity.ps1
# 加 -Print 只印出三個值不上傳；-App 指定 fly app 名稱（預設 ai-usageweb）。
#
# 做的事：
#  1. 從 Windows 認證管理員讀出 agy 登入後存的 refresh token
#  2. 從官方 agy.exe 讀出它內建的 Google OAuth client id / secret
#  3. 找出能續期這個 refresh token 的那一組 client（找到就停）
#  4. 用 fly secrets set 設定 ANTIGRAVITY_REFRESH_TOKEN / CLIENT_ID / CLIENT_SECRET
# 全程不把 token 印到畫面（除非你自己加 -Print）。
param([string]$App = "ai-usageweb", [switch]$Print)
$ErrorActionPreference = "Stop"

# --- 1. 讀認證管理員 ---
$sig = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CredR {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr creds);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static byte[] Find(string match) {
    int count; IntPtr arr;
    if (!CredEnumerate(null, 0, out count, out arr)) throw new Exception("CredEnumerate failed: " + Marshal.GetLastWin32Error());
    byte[] found = null;
    for (int i = 0; i < count; i++) {
      IntPtr p = Marshal.ReadIntPtr(arr, i * IntPtr.Size);
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      string name = Marshal.PtrToStringUni(c.TargetName);
      if (name != null && name.Contains(match) && c.CredentialBlobSize > 0) {
        found = new byte[c.CredentialBlobSize];
        Marshal.Copy(c.CredentialBlob, found, 0, c.CredentialBlobSize);
        break;
      }
    }
    CredFree(arr);
    return found;
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp | Out-Null

$bytes = [CredR]::Find("gemini:antigravity")
if (-not $bytes) { throw "找不到 Antigravity 的登入憑證，請先用 agy 以 Google 帳號登入一次。" }
$text = [System.Text.Encoding]::Unicode.GetString($bytes)
if ($text -notmatch '[{"]') { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }
$cred = ($text.Trim([char]0, ' ', "`r", "`n")) | ConvertFrom-Json
$refresh = $cred.token.refresh_token
if (-not $refresh) { throw "憑證裡沒有 refresh token，請重新用 agy 登入。" }

# --- 2. 從 agy.exe 讀出 client id / secret ---
$pkg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Directory -ErrorAction SilentlyContinue |
  Where-Object Name -like 'Google.AntigravityCLI*' | Select-Object -First 1
$exe = if ($pkg) { Join-Path $pkg.FullName 'agy.exe' } else { (Get-Command agy -ErrorAction SilentlyContinue).Source }
if (-not $exe -or -not (Test-Path $exe)) { throw "找不到 agy.exe，請先 winget install Google.AntigravityCLI。" }

$raw = [System.IO.File]::ReadAllText($exe, [System.Text.Encoding]::GetEncoding("latin1"))
$ids = [regex]::Matches($raw, '[0-9]{8,14}-[a-z0-9]{32}\.apps\.googleusercontent\.com') | ForEach-Object { $_.Value } | Select-Object -Unique
$secrets = [regex]::Matches($raw, 'GOCSPX-[A-Za-z0-9_-]{28}') | ForEach-Object { $_.Value } | Select-Object -Unique
Write-Host "候選 client：$($ids.Count) 組，secret：$($secrets.Count) 組，開始比對…"

# --- 3. 找出能續期的那一組 ---
$clientId = $null; $clientSecret = $null
:outer foreach ($id in $ids) {
  foreach ($sec in $secrets) {
    try {
      $resp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ client_id = $id; client_secret = $sec; refresh_token = $refresh; grant_type = "refresh_token" } `
        -ErrorAction Stop
      if ($resp.access_token) { $clientId = $id; $clientSecret = $sec; break outer }
    } catch { }
  }
}
if (-not $clientId) { throw "沒有找到能續期的 client 組合；agy 的版本可能換了 client。" }
Write-Host "比對成功：client ...$($clientId.Substring(0,13).Substring(7))"

# --- 4. 設定 / 輸出 ---
if ($Print) {
  "ANTIGRAVITY_REFRESH_TOKEN=$refresh"
  "ANTIGRAVITY_CLIENT_ID=$clientId"
  "ANTIGRAVITY_CLIENT_SECRET=$clientSecret"
  return
}
$fly = (Get-Command fly, flyctl -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $fly) {
  $fly = @("$env:USERPROFILE\.fly\bin\fly.exe", "$env:USERPROFILE\.fly\bin\flyctl.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $fly) { throw "找不到 fly CLI，請先安裝並 fly auth login。" }
& $fly secrets set --app $App "ANTIGRAVITY_REFRESH_TOKEN=$refresh" "ANTIGRAVITY_CLIENT_ID=$clientId" "ANTIGRAVITY_CLIENT_SECRET=$clientSecret"
Write-Host "已設定到 fly app '$App'，部署後 Antigravity 卡片就會出現。"
