# Business Requirements Document (BRD)

**Project Name**: Syllabux API-Only ERP
**Date**: 2026-06-06
**Revision**: 2

## 1. Project Overview

The objective is to build a comprehensive, API-only Enterprise Resource Planning (ERP) system designed specifically for autonomous management by CLI AI assistants. The system expands beyond standard CRM features to include Human Resources (HR), Accounting, Invoicing, and Inventory Management. It will also feature an internal scheduling system and a highly granular Role-Based Access Control (RBAC) mechanism tailored for individual CLI AI assistants.

## 2. Technical Stack

- **Backend**: Node.js with Express.js
- **Database**: SQLite
- **Identifiers**: Universally Unique Identifiers (UUIDs) for all primary keys.
- **Search**: SQLite FTS5 indexes on relevant text fields across all modules.
- **API Contract**: OpenAPI 3.0 specification auto-generated from route definitions. This is the primary interface contract for CLI AI assistant tool-calling.
- **API Versioning**: All endpoints are prefixed with a version path (e.g., `/v1/`). Breaking changes require a new version.

## 3. Non-Functional Requirements

### 3.1. Audit Logging

- Every mutating API call (POST, PUT, PATCH, DELETE) must be logged to a dedicated `audit_log` table.
- Each log entry must record: the assistant API key, the action performed, the target resource type and ID, the before/after state (as JSON), a timestamp, and an optional idempotency key.
- Audit logs are append-only and must never be deleted or modified by the API.

### 3.2. Idempotency

- All state-changing endpoints that carry financial or irreversible consequences (invoice creation, payment recording, payroll processing, journal entries, stock adjustments) must accept an `Idempotency-Key` header.
- If a request is received with an idempotency key that has already been processed, the API must return the original response without re-executing the operation.

### 3.3. Rate Limiting

- Per-assistant rate limits must be enforced based on the assistant's API key.
- Rate limit configuration (requests per minute/hour) must be stored in the database alongside the assistant record, allowing per-assistant tuning.
- Rate-limited responses must return standard `429 Too Many Requests` with `Retry-After` headers.

### 3.4. Pagination & Filtering

- All list endpoints must support cursor-based pagination by default, returning `next_cursor` and `has_more` fields.
- Standard query parameters: `limit` (max 100, default 25), `cursor`.
- Filterable fields must be documented per-endpoint in the OpenAPI spec.

### 3.5. Data Validation & Constraints

- All incoming request bodies must be validated against defined JSON schemas before processing.
- Validation errors must return `422 Unprocessable Entity` with a structured error response listing all failed fields and their constraints.
- Business rule violations (e.g., invoicing a cancelled client, overspending inventory) must return `409 Conflict` with a clear description.

### 3.6. Error Handling

- All error responses must follow a consistent structure: `{ error: { code, message, details } }`.
- HTTP status codes must be used correctly and consistently across all modules.

### 3.7. Backup & Recovery

- Database backup strategy must be defined (automated daily snapshots at minimum).
- The accounting module's journal entries must be treated as immutable; corrections are made via reversing entries, never deletion.

## 4. Core Modules & Requirements

### 4.1. Security, Authentication & RBAC

- **Assistant Identity**: Each CLI AI assistant interacting with the system must be issued a unique API Key.
- **Granular RBAC**: Access rights must be defined at a granular level directly within the SQLite database (e.g., `read:invoices`, `write:hr_records`, `process:payroll`).
- **Row-Level Scoping (Optional)**: Support optional row-level access rules where an assistant's permissions can be scoped to specific records (e.g., Assistant A can only access invoices for clients assigned to it). This is defined via a scoping table linking assistant → resource type → allowed record IDs or filter criteria.
- **Enforcement**: The API must validate the assistant's API key and strictly enforce these database-defined permissions on every endpoint.

### 4.2. CRM, Sales Pipeline & Internal Scheduling

#### Leads & Pipeline

- **Lead Management**: Track inbound leads with source attribution, contact details, and status.
- **Pipeline Stages**: Leads progress through configurable pipeline stages (e.g., New → Qualified → Proposal → Negotiation → Won → Lost).
- **Conversion**: When a lead is won, it converts into a Client record. The original lead record is preserved for attribution and reporting.

#### Clients

- Manage B2C (individual) and B2B (corporate) clients. B2B clients support a one-to-many relationship with Contact Persons.
- Each client has a lifecycle status (Active, Inactive, Suspended, Churned).

#### Interactions

- Track all communications, emails, and meeting notes.
- Interactions can be linked to either a Lead or a Client.

#### Scheduling

- Fully internal event and to-do scheduling. Events are managed natively within the database.
- Events can be linked to Leads, Clients, Employees, or stand-alone.

### 4.3. Product Catalog

The system must support a unified product catalog categorizing offerings into three distinct types:

1. **Subscription-Based Services**: Recurring billing models with defined billing intervals (monthly, quarterly, annually).
2. **One-Time Services**: Non-recurring labor or consulting.
3. **One-Time Products**: Physical or digital goods.

Each product must support:

- A default price and currency.
- One or more applicable tax categories (see §4.5).

### 4.4. Inventory Management

- Track stock levels for physical "One-Time Products".
- Manage stock adjustments (manual correction, damage, return) with reason codes.
- Track availability and support low-stock threshold alerts.

#### Procurement

- **Purchase Orders**: Create purchase orders to suppliers to replenish stock.
- **Receiving**: Record goods received against a purchase order, automatically adjusting stock levels.
- **Supplier Management**: Maintain a supplier directory with contact details and payment terms.

### 4.5. Invoicing & Billing

#### Tax Handling

- Maintain a `tax_rates` table defining tax categories (e.g., Standard VAT, Reduced VAT, Zero-Rated, Exempt) with their percentage rates.
- Each invoice line item must reference the applicable tax rate. Tax is calculated per line item and summed for the invoice total.

#### Multi-Currency

- All monetary fields must store a `currency` code (ISO 4217, e.g., `USD`, `EUR`, `NGN`).
- A default system currency is configured globally, but invoices can be issued in any supported currency.
- Exchange rates are stored in a reference table and applied at the time of invoice creation.

#### Invoice Lifecycle

- Generate invoices linking Clients to Products/Services.
- Track invoice lifecycles: Draft → Sent → Partially Paid → Paid → Overdue → Cancelled → Void.
- Handle line items reflecting the 3 distinct product types.

#### Payments

- Record payments against invoices, supporting partial and overpayments.
- Track payment method (bank transfer, card, cash, credit note, etc.).
- Each payment record triggers a corresponding journal entry in the Accounting module (see §4.6).

### 4.6. Accounting

#### Chart of Accounts

- Maintain a standard Chart of Accounts (Assets, Liabilities, Equity, Revenue, Expenses).
- Accounts are hierarchical (parent/child) to support sub-accounts.

#### Double-Entry Bookkeeping

- Log Journal Entries and Journal Lines (Debits and Credits).
- Journal entries are **immutable** — corrections are made via reversing entries.

#### Automated Journal Generation

The following events must automatically generate corresponding journal entries:

- **Invoice Sent**: Debit Accounts Receivable, Credit Revenue.
- **Payment Received**: Debit Cash/Bank, Credit Accounts Receivable.
- **Payroll Processed**: Debit Salary Expense, Credit Cash/Bank and Payable accounts.
- **Inventory Purchased**: Debit Inventory Asset, Credit Accounts Payable or Cash/Bank.
- **Inventory Sold** (via invoice): Debit Cost of Goods Sold, Credit Inventory Asset.

CLI AI assistants may also create manual journal entries for events not covered by automation (with appropriate RBAC permissions).

#### Accounts Receivable (AR)

- Track outstanding balances per client derived from sent invoices minus recorded payments.
- Support aging reports (current, 30-day, 60-day, 90-day overdue).

#### Accounts Payable (AP)

- Track outstanding balances to suppliers derived from purchase orders minus payments made.

### 4.7. Human Resources (HR) & Payroll

#### Employee Management

- Manage employee records (Name, Department, Role, Start Date, Employment Type, Status).
- Store basic organizational structure (departments, reporting lines).
- Track employee lifecycle: Onboarding → Active → On Leave → Terminated.

#### Payroll

- Manage salary details (base salary, allowances, deductions) per employee.
- Process payroll runs for a given period, generating individual payslips.
- Each payroll run triggers automated journal entries in the Accounting module.

#### Attendance

- Track employee daily attendance, clock-in/clock-out times, and hours worked.
- Record leaves of absence linked to specific leave types.

#### Leave Management

- Define leave types (Annual, Sick, Compassionate, Unpaid, etc.) with per-type annual entitlements.
- Track leave balances per employee with accrual support.
- Leave requests follow an approval workflow (Pending → Approved → Rejected).

#### Performance

- Log periodic performance reviews, ratings, and managerial feedback notes.
- Reviews are linked to specific review periods and the reviewing manager.

## 5. Internal Event System

### 5.1. Cross-Module Event Bus

- When a significant event occurs in one module (e.g., invoice created, payment received, employee terminated), the system must publish an internal event record to an `events` table.
- Other modules or assistants can query the events table (filtered by event type, timestamp, status) to react to cross-module changes.
- Each event record contains: `event_type`, `source_module`, `resource_type`, `resource_id`, `payload` (JSON), `created_at`, and `processed` flag.

### 5.2. Webhook Subscriptions (Future Phase)

- Assistants can register webhook URLs to receive push notifications for specific event types.
- This is deferred to a future phase but the event table design must accommodate it.

## 6. Delivery Phases

### Phase 1 — Foundation

- Security, Authentication & RBAC (§4.1)
- CRM, Sales Pipeline & Scheduling (§4.2)
- Product Catalog (§4.3)
- Non-functional infrastructure: audit logging, idempotency, pagination, validation, error handling
- OpenAPI spec generation

### Phase 2 — Revenue

- Invoicing & Billing with tax and multi-currency (§4.5)
- Accounting with automated journal entries and AR (§4.6)
- Internal Event System (§5.1)

### Phase 3 — Operations

- Inventory Management & Procurement (§4.4)
- Accounts Payable (§4.6)

### Phase 4 — People

- HR, Payroll, Attendance, Leave, Performance (§4.7)

### Phase 5 — Intelligence

- Webhook subscriptions (§5.2)
- Row-level RBAC scoping (§4.1)
- Reporting & analytics endpoints
