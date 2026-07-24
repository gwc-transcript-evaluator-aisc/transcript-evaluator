#!/bin/bash
# Deploy both Lambda functions from the current directory.
# Run this from CloudShell after git pull.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Deploying transcript-upload-handler ==="
rm -rf /tmp/upload_package /tmp/upload_handler.zip
mkdir -p /tmp/upload_package
cp lambda_upload.py lambda_processor.py bda_service.py catalogue_service.py config.py database.py /tmp/upload_package/
cd /tmp/upload_package
zip -r /tmp/upload_handler.zip .
aws lambda update-function-code \
  --function-name transcript-upload-handler \
  --zip-file fileb:///tmp/upload_handler.zip \
  --query "CodeSha256" --output text
echo "Upload handler deployed."

echo ""
echo "=== Deploying transcript-result-processor ==="
rm -rf /tmp/processor_package /tmp/processor_handler.zip
mkdir -p /tmp/processor_package
cp lambda_processor.py bda_service.py config.py database.py /tmp/processor_package/
cd /tmp/processor_package
zip -r /tmp/processor_handler.zip .
aws lambda update-function-code \
  --function-name transcript-result-processor \
  --zip-file fileb:///tmp/processor_handler.zip \
  --query "CodeSha256" --output text
echo "Result processor deployed."

echo ""
echo "=== Deploying index.html to S3 ==="
cd "$SCRIPT_DIR"
aws s3 cp index.html s3://transcript-web-groupten/index.html --content-type "text/html"
aws s3 cp review.html s3://transcript-web-groupten/review.html --content-type "text/html"
echo "Website deployed."

echo ""
echo "=== All done ==="
