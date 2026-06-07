# Open API ERP

A comprehensive, API-only Enterprise Resource Planning (ERP) system designed specifically for autonomous management by AI agents/assistants.

This project is architected to be a robust, headless system serving as the backend for intelligent agents handling an organization's core operations.

## Core Modules

- **Granular RBAC**: Highly restrictive Role-Based Access Control and Row-Level Scoping tailored for autonomous AI agents.
- **CRM & Scheduling**: Sales pipeline management, client interactions, and internal event scheduling.
- **Product Catalog**: Unified tracking of subscription services, one-time services, and physical products.
- **Invoicing & Accounting**: Fully compliant double-entry bookkeeping, automated journal entries, lock periods, and tax calculations.
- **Inventory & Procurement**: Stock level tracking, adjustments, and supplier purchase orders.
- **Human Resources**: Employee lifecycles, attendance tracking, leave approval workflows, and automated payroll runs.

## Documentation Overview

Comprehensive documentation mapping the requirements, design, and architecture can be found in the `docs/` directory:

- [Business Requirements Document (BRD)](./docs/ERP-BRD.md)
- [Technical Architecture & Implementation Plan](./docs/ERP-Architecture-Plan.md)
- [Entity Relationship Diagram (ERD) & Data Dictionary](./docs/ERP-ERD-Data-Dictionary.md)
- [Role-Based Access Control (RBAC) Matrix](./docs/ERP-RBAC-Matrix.md)
- [State Machines & Workflows](./docs/ERP-State-Machines.md)
- [OpenAPI 3.1 Specification](./docs/ERP-OpenAPI-Spec.yaml)

## Technology Stack

- **Backend**: Node.js with TypeScript & Express.js
- **Database**: SQLite (WAL mode) via `better-sqlite3`
- **Validation**: Zod (with OpenAPI auto-generation via `@asteasolutions/zod-to-openapi`)
- **Search**: Built-in SQLite FTS5 indexes and synchronizing triggers

## Implementation Status

The system is **fully implemented** and all modules are fully operational:

- **CRM**: Lead-to-client conversions, contacts, interactions, and scheduling.
- **Catalog**: Subscription-based services, physical/digital inventory catalog, tax configurations, and multicurrency support.
- **Invoicing**: Automatic tax lines, billing periods, partial/full payments tracking, and event-based double-entry ledger hooks.
- **Accounting**: Balanced double-entry verification (Debits = Credits), immutable journal lines, closed period locking with date overlap verification, and aging/trial balance reports.
- **Inventory**: Real-time stock levels, purchase orders (POs) with automatic receiving reconciliation, and inventory adjustments.
- **HR**: Employee lifecycles, leaf attendance tracking, salary and expense runs, and automated payroll posting.
- **Worker & Bus**: Polling-based background outbox event processing, automatic subscription invoicing renewals, and webhook notification dispatches.

## Security & Compliance

The system includes built-in security controls out of the box:

- **CORS Policies**: Manual CORS middleware permits requests from any origin (`*`) to ensure autonomous AI assistants running from different environments can communicate seamlessly with the API.
- **Security Headers**: Standard secure HTTP headers are enforced (e.g., `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) to protect against clickjacking and MIME-sniffing.
- **Audit Log Redaction**: A recursive sanitizer automatically replaces sensitive parameters (such as `apiKey`, `secret`, `password`, `token`) with `[REDACTED]` in the stored audit logs before saving.
- **SSRF Prevention**: Webhook registrations validate destination URLs, rejecting requests targeting loopbacks (`127.0.0.1`), link-locals (`169.254.169.254`), or private RFC 1918 subnets.

## Getting Started

### 1. Installation

Install dependencies:

```bash
npm install
```

### 2. Setup Environment Variables

Copy `.env.example` to `.env` (it will default to port `11122` and database path `./data/erp.db`):

```bash
cp .env.example .env
```

If you wish to use the client helper scripts or agent skills, you can configure your assistant's active API key by adding it to your `.env` file:

```text
API_KEY=erp_...
```

### 3. Run Migrations & Seed Data

Run migrations to configure the SQLite database:

```bash
npm run migrate
```

Seed the initial System Administrator assistant and provision the Chart of Accounts:

```bash
npm run seed
```

_Note: Make sure to save the output plaintext API key for subsequent requests. You can add it as `API_KEY=your_key` in `.env` to authenticate client tools, or manage and provision assistants at any time via the `./manage_assistant.py` CLI._

### 4. Running the Application

To start the server in watch mode:

```bash
npm run dev
```

To build and run in production mode:

```bash
npm run build
npm start
```

### 5. Running Tests

Execute the full suite of integration tests covering RBAC, rate-limiting, idempotency keys, CRM conversion, double-entry bookkeeping, and period closure:

```bash
npm run test
```

### 6. Backups

To create a WAL-safe hot backup of the SQLite database:

```bash
npm run backup
```

### 7. Interactive API Docs

Once the server is running, navigate to `http://localhost:11122/v1/api-docs/` in your browser to view the interactive Swagger UI API specification. Passing the `x-api-key` header of an assistant to `/v1/api-docs/openapi.json` will filter the spec, returning only the scoped endpoints that assistant has access to.

### 8. Managing Assistants (Interactive CLI)

A Python script is provided to interactively manage registered assistants, their roles, and their RBAC permissions.

Run the utility:

```bash
./manage_assistant.py
```

Using this utility, you can:

1. **List Registered Assistants**: View all registered assistants, their roles, prefixes, rate limits, status, and permissions.
2. **Add New Assistant & Generate Key**: Registers a new assistant, prompts for rate limits, administrator status, and configures their granular RBAC permissions. Generates a secure API key (`erp_` + 64 hex characters) and prints it once.
3. **Edit Assistant Details**: Modify an existing assistant's name, rate limit, and administrator role.
4. **Set RBAC Permissions**: Add, remove, or modify fine-grained API permission scopes for any standard assistant using a visual categorized checklist.
5. **Remove Assistant**: Permanently delete an assistant and clean up their associated API keys and permissions from the database.
