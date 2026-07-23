# Course Catalog API

Standalone AWS serverless API for asynchronous extraction of articulation-focused course data from PDF catalogs using Amazon Bedrock Data Automation.

## Workflow

1. `POST /jobs` returns a job ID and a short-lived S3 upload URL.
2. Upload the PDF with `PUT` to that URL.
3. `POST /jobs/{jobId}/complete` starts asynchronous BDA processing.
4. Poll `GET /jobs/{jobId}`.
5. Retrieve `GET /jobs/{jobId}/result` after completion.

The stack provisions the BDA document blueprint and an ASYNC Data Automation project automatically. The project attaches the course blueprint and the processing Lambda receives the generated project ARN and the `us.data-automation-v1` profile ARN. No manual BDA ARN configuration is required.

## Static frontend

The `frontend/` directory is a dependency-free browser UI. It uploads a PDF through the API, polls the job, and renders extracted courses. Set the deployed API URL in `frontend/config.js` before syncing:

```js
window.COURSE_CATALOG_CONFIG = { apiBaseUrl: 'https://your-api.execute-api.region.amazonaws.com' };
```

After deploying the CDK stack, sync the static files to the output `WebsiteBucketName`:

```bash
aws s3 sync frontend s3://YOUR_WEBSITE_BUCKET --delete
```

Open the `WebsiteUrl` stack output. For a one-off test, the API URL can also be supplied as `?api=https://your-api.execute-api.region.amazonaws.com`. The S3 website endpoint is intentionally simple for this prototype and serves over HTTP; use CloudFront or another HTTPS layer before production use.


```bash
npm install
npm test
npm run build
npm run synth
```

This is a public prototype. Before production use, add authentication, stronger abuse prevention, document privacy controls, and human review for articulation decisions.
