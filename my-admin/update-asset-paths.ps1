# Update asset paths from /asset/ to /assets/
$sourceDir = "d:\Vgreen\my-admin\src"
$files = Get-ChildItem -Path $sourceDir -Recurse -Include *.html,*.css,*.ts,*.scss

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    if ($content -match '/asset/') {
        $newContent = $content -replace '/asset/', '/assets/'
        Set-Content -Path $file.FullName -Value $newContent -NoNewline
        Write-Host "Updated: $($file.Name)"
    }
}

Write-Host "`nCompleted! Updated $($files.Count) files."
