# Summer Camp

Course catalog extraction and articulation platform powered by AWS Bedrock.

## Monorepo Structure

```
summer-camp/
├── packages/
│   ├── course-catalog-api/    # Course catalog extraction API (CDK/Lambda)
│   └── shared/                # Shared types and utilities (future)
├── .agents/                   # Kiro AI agents
├── .kiro/                     # Kiro configuration
└── package.json               # Root workspace configuration
```

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

### Installation

```bash
# Install all workspace dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm run test
```

## Packages

### course-catalog-api

Asynchronous course catalog extraction API using S3, Step Functions, and Bedrock Data Automation.

Features:
- PDF upload via presigned S3 URLs
- Automatic page splitting and parallel processing
- Course data extraction using Bedrock blueprints
- DynamoDB storage with single-table design
- Static web UI for testing

[See package README](./packages/course-catalog-api/README.md) for details.

## Development

### Adding a New Package

1. Create directory: `mkdir packages/my-new-package`
2. Initialize: `cd packages/my-new-package && npm init`
3. Set package name: `@summer-camp/my-new-package`
4. Install from root: `npm install`

### Running Commands in Specific Packages

```bash
# Run command in specific package
npm run build -w packages/course-catalog-api

# Deploy course catalog API
npm run cdk deploy -w packages/course-catalog-api
```

## License

MIT
