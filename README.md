<p align="center">
  <img alt="Real Oficial Logo" src="https://cdn.realoficial.com.br/logo_v2.png" width="300">
</p>

# Real Oficial API Documentation

[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](CONTRIBUTING.md)

Real Oficial is a platform for automatic video clip creation using AI. Built for content creators, it offers:

- Automatic short video generation from YouTube, Google Drive, or direct links (.mp4)
- AI-powered best moments detection
- High-quality rendering for TikTok, Instagram Reels, and YouTube Shorts
- Simple REST API for integration
- Bearer token authentication

The documentation covers everything from getting started guides to detailed API references, helping you integrate automatic video clipping into your application.

## Quick Start

This documentation is built with [Mintlify](https://mintlify.com)

1. **Preview locally**
```bash
# Install Mintlify CLI
npm i -g mintlify

# Start development server
mintlify dev
```

2. **Visit `http://localhost:3000` to see your documentation**

## Documentation Structure

```
.
├── api-reference/     # API endpoints documentation
│   ├── auth/          # Authentication endpoints
│   ├── projects/      # Projects management
│   ├── shorts/        # Shorts listing
│   └── renders/       # Render operations
├── images/            # Documentation images
├── logo/              # Brand logos
├── introduction.mdx   # Getting started guide
├── authentication.mdx # Authentication guide
├── docs.json          # Mintlify configuration
└── README.md          # This file
```

## Local Development

1. **Install dependencies**
```bash
npm i -g mintlify
```

2. **Start development server**
```bash
mintlify dev
```

### OR

Run using docker:
```bash
make start
```

### Troubleshooting

- If Mintlify dev isn't running, try `mintlify install` to reinstall dependencies
- For 404 errors, ensure you're in a directory with `docs.json`

## Deployment

Changes are automatically deployed when merged to the `main` branch through the Mintlify GitHub integration.

## Support

- Join our [Discord community](https://discord.gg/realoficial)
- Email: antonio@realoficial.com.br
