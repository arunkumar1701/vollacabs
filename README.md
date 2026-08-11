# AI Agent Workflow Builder

This is a full-stack internship assignment for an AI Agent Workflow Builder. It allows organizations to build, execute, and monitor automated AI workflows using PostgreSQL, Hasura GraphQL, Nhost, Next.js, and the Google Gemini API.

## Local Development

To run the application locally:

1. Copy `.env.example` to `.env.local` and fill in your Nhost and Gemini API keys.
2. Install dependencies: `npm install`
3. Run the development server: `npm run dev`
4. The frontend will be available at `http://localhost:3000`.

## Architecture Overview

- **Frontend:** Next.js (App Router), React, Tailwind CSS, Apollo Client
- **Backend/BaaS:** Nhost (PostgreSQL, Hasura GraphQL, Authentication, Serverless Functions)
- **AI Integration:** Google Gemini API (Server-side execution only)

## Phase 5C: Notification Stub

Note: The notification provider implemented in this project (`/api/notifyWebhook`) is a **stub with an artificial delay** to simulate real-world behavior for assignment purposes. It does **not** actually deliver messages to real Slack workspaces or Email inboxes. The workflow engine correctly inserts notifications into the `workflow_notifications` table, which triggers a Hasura Event Trigger that securely calls the backend stub. No false claims of actual delivery are made in the system.
