# Open API ERP

A comprehensive, API-only Enterprise Resource Planning (ERP) system designed specifically for autonomous management by CLI AI assistants.

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

* **Backend**: Node.js with TypeScript & Express.js
* **Database**: SQLite (WAL mode) via `better-sqlite3`
* **Validation**: Zod (with OpenAPI auto-generation)
* **Search**: Built-in SQLite FTS5 index

## Implementation Status

The project has completed the architectural design phase and is currently preparing to enter **Phase 1** of active development (Core Infrastructure & CRM).
