# Deploy script for local machine (Windows PowerShell)
# Run after git push: .\deploy_local.ps1

$ErrorActionPreference = "Stop"
$region = "us-west-2"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== Packaging upload handler ===" -ForegroundColor Cyan
$uploadDir = "$env:TEMP\upload_package"
if (Test-Path $uploadDir) { Remove-Item -Recurse -Force $uploadDir }
New-Item -ItemType Directory -Path $uploadDir | Out-Null
Copy-Item "$projectDir\lambda_upload.py" $uploadDir
Copy-Item "$projectDir\lambda_processor.py" $uploadDir
Copy-Item "$projectDir\bda_service.py" $uploadDir
Copy-Item "$projectDir\catalogue_service.py" $uploadDir
Copy-Item "$projectDir\config.py" $uploadDir
Copy-Item "$projectDir\database.py" $uploadDir
$uploadZip = "$env:TEMP\upload_handler.zip"
if (Test-Path $uploadZip) { Remove-Item $uploadZip }
Compress-Archive -Path "$uploadDir\*" -DestinationPath $uploadZip
Write-Host "Deploying upload handler..." -ForegroundColor Yellow
aws lambda update-function-code --function-name transcript-upload-handler --zip-file "fileb://$uploadZip" --region $region --query "CodeSha256" --output text
Write-Host "Upload handler deployed." -ForegroundColor Green

Write-Host ""
Write-Host "=== Packaging result processor ===" -ForegroundColor Cyan
$procDir = "$env:TEMP\processor_package"
if (Test-Path $procDir) { Remove-Item -Recurse -Force $procDir }
New-Item -ItemType Directory -Path $procDir | Out-Null
Copy-Item "$projectDir\lambda_processor.py" $procDir
Copy-Item "$projectDir\bda_service.py" $procDir
Copy-Item "$projectDir\config.py" $procDir
Copy-Item "$projectDir\database.py" $procDir
$procZip = "$env:TEMP\processor_handler.zip"
if (Test-Path $procZip) { Remove-Item $procZip }
Compress-Archive -Path "$procDir\*" -DestinationPath $procZip
Write-Host "Deploying result processor..." -ForegroundColor Yellow
aws lambda update-function-code --function-name transcript-result-processor --zip-file "fileb://$procZip" --region $region --query "CodeSha256" --output text
Write-Host "Result processor deployed." -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploying website ===" -ForegroundColor Cyan
aws s3 cp "$projectDir\index.html" s3://transcript-web-groupten/index.html --content-type "text/html" --region $region
aws s3 cp "$projectDir\review.html" s3://transcript-web-groupten/review.html --content-type "text/html" --region $region
aws s3 cp "$projectDir\view.html" s3://transcript-web-groupten/view.html --content-type "text/html" --region $region
Write-Host "Website deployed." -ForegroundColor Green

Write-Host ""
Write-Host "=== All done ===" -ForegroundColor Green
