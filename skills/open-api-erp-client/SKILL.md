---
name: open-api-erp-client
version: 1.0.0
description: |
  Consume and manage all modules of the Open API ERP system.
  Provides complete command references for CRM, Catalog, Invoicing, Accounting, Inventory, HR, Webhooks, and Assistants.
---

# Open API ERP Client Skill

> [!CAUTION]
> **IMMUTABILITY POLICY**: This skill serves as a static interface specification and core reference instruction set.
> Self-evolving AI assistants, agents, or automated routines **MUST NEVER** alter, modify, improve, adjust, or refine this file (`SKILL.md`) or any resources inside this skill directory.
> Modifying this specification breaks interface contract consistency and compromises client compatibility.

This skill allows AI agents to interact with every module of the **Open API ERP** backend.

## Prerequisites

- Base URL: Default is `http://localhost:11122/v1`
- Credentials: API keys are validated using the `x-api-key` header.
- Optional Environment Variables:
  - `ERP_BASE_URL` (custom backend host)
  - `ERP_API_KEY` (plaintext raw key)
  - You can write your API key to `~/.erp/credentials` for automatic loading.

---

## 1. Authentication & Security Policy

All API requests must carry the `x-api-key` header containing the raw API key.

- **CORS**: Wildcard `*` origins are accepted.
- **Security Headers**: Standard headers like `X-Content-Type-Options: nosniff` are present.
- **Audit Logs**: Mutating requests (POST/PUT/PATCH/DELETE) are automatically written to `audit_logs`. Sensitive data (API keys, secrets, tokens) are automatically redacted as `[REDACTED]`.

---

## 2. Rate Limiting & Idempotency

- **Rate Limits**: Rate limits are enforced based on the assistant's provisioning settings. Exceeding it returns `429 Too Many Requests` with a `Retry-After` header.
- **Idempotency**: All financial or state-changing operations support an optional `Idempotency-Key` header. Resending requests with the same key returns cached responses.

---

## 3. API Task Reference

Here is a command reference for every available API task using the helper client script `./scripts/client.sh`.

### 3.1. Core & Assistants Module

Permissions required: `read:assistants`, `write:assistants`

#### Create a New Assistant

```bash
./scripts/client.sh POST assistants '{"name": "CRM Assistant", "permissions": ["read:leads", "write:leads", "convert:lead"], "rateLimitPerMinute": 60, "isAdmin": false}'
```

#### List Assistants

```bash
./scripts/client.sh GET assistants
```

#### Get Assistant details

```bash
./scripts/client.sh GET assistants/{id}
```

#### Update Assistant Details

```bash
./scripts/client.sh PUT assistants/{id} '{"name": "Updated Assistant", "status": "active"}'
```

#### Delete Assistant

```bash
./scripts/client.sh DELETE assistants/{id}
```

#### Add Row-Level Authorization Scope

```bash
./scripts/client.sh POST assistants/{id}/scopes '{"resource_type": "leads", "resource_id": "{lead_uuid}"}'
```

#### List Scopes for Assistant

```bash
./scripts/client.sh GET assistants/{id}/scopes
```

#### Delete Scope for Assistant

```bash
./scripts/client.sh DELETE assistants/{id}/scopes/{scopeId}
```

---

### 3.2. CRM Module

Permissions required: `read:leads`, `write:leads`, `read:clients`, `write:clients`, `convert:lead`, `read:interactions`, `write:interactions`, `read:scheduled_events`, `write:scheduled_events`

#### Create a Lead

```bash
./scripts/client.sh POST crm/leads '{"first_name": "John", "last_name": "Doe", "company_name": "Acme Corp", "stage": "new", "source": "website"}'
```

#### List Leads

```bash
./scripts/client.sh GET crm/leads
# For FTS search:
./scripts/client.sh GET "crm/leads?q=Acme"
```

#### Get Lead details

```bash
./scripts/client.sh GET crm/leads/{id}
```

#### Update Lead

```bash
./scripts/client.sh PUT crm/leads/{id} '{"stage": "negotiation"}'
```

#### Convert Lead to Client (Attribution retained)

```bash
./scripts/client.sh POST crm/leads/{id}/convert
```

#### Delete Lead

```bash
./scripts/client.sh DELETE crm/leads/{id}
```

#### Create a Client (Direct)

```bash
./scripts/client.sh POST crm/clients '{"type": "b2b", "name": "Direct Company", "currency": "USD"}'
```

#### List Clients

```bash
./scripts/client.sh GET crm/clients
# To include soft-deleted records:
./scripts/client.sh GET "crm/clients?include_deleted=true"
```

#### Update Client Details

```bash
./scripts/client.sh PUT crm/clients/{id} '{"address": "123 Main St"}'
```

#### Delete Client (Soft Delete)

```bash
./scripts/client.sh DELETE crm/clients/{id}
```

#### Create Contact Person for Client

```bash
./scripts/client.sh POST crm/clients/{clientId}/contacts '{"first_name": "Jane", "last_name": "Smith", "email": "jane@example.com", "role": "Billing Contact", "is_primary": true}'
```

#### List Contacts for Client

```bash
./scripts/client.sh GET crm/clients/{clientId}/contacts
```

#### Update Contact

```bash
./scripts/client.sh PUT crm/contacts/{id} '{"role": "Primary CFO"}'
```

#### Delete Contact

```bash
./scripts/client.sh DELETE crm/contacts/{id}
```

#### Log Customer Interaction

```bash
./scripts/client.sh POST crm/interactions '{"client_id": "{client_id}", "type": "call", "subject": "Introductory Call", "body": "Discussed subscription tiers."}'
```

#### List Interactions

```bash
./scripts/client.sh GET crm/interactions
# Or filter:
./scripts/client.sh GET "crm/interactions?client_id={client_id}"
```

#### Delete an Interaction

```bash
./scripts/client.sh DELETE crm/interactions/{id}
```


#### Create a Scheduled Event / Task

```bash
./scripts/client.sh POST crm/scheduled-events '{"title": "Follow up meeting", "event_type": "meeting", "start_time": "2026-06-10T10:00:00Z", "client_id": "{client_id}"}'
```

#### List Events

```bash
./scripts/client.sh GET crm/scheduled-events
```

#### Update Event status

```bash
./scripts/client.sh PUT crm/scheduled-events/{id} '{"status": "completed"}'
```

#### Delete Event

```bash
./scripts/client.sh DELETE crm/scheduled-events/{id}
```

---

### 3.3. Catalog Module

Permissions required: `read:products`, `write:products`, `read:tax_rates`, `write:tax_rates`, `read:exchange_rates`, `write:exchange_rates`

#### Create a Product or Service

```bash
./scripts/client.sh POST catalog/products '{"sku": "SUB-PRO-01", "name": "Monthly Pro Subscription", "type": "subscription", "default_price": 49.99, "currency": "USD", "billing_interval": "monthly"}'
```

#### List Products

```bash
./scripts/client.sh GET catalog/products
```

#### Update Product details

```bash
./scripts/client.sh PUT catalog/products/{id} '{"default_price": 54.99}'
```

#### Delete Product (Soft Delete)

```bash
./scripts/client.sh DELETE catalog/products/{id}
```

#### Create a Tax Rate

```bash
./scripts/client.sh POST catalog/tax-rates '{"name": "Standard VAT", "rate": 0.20, "is_default": true}'
```

#### List Tax Rates

```bash
./scripts/client.sh GET catalog/tax-rates
```

#### Create an Exchange Rate

```bash
./scripts/client.sh POST catalog/exchange-rates '{"from_currency": "USD", "to_currency": "EUR", "rate": 0.92, "effective_date": "2026-06-07"}'
```

#### List Exchange Rates

```bash
./scripts/client.sh GET catalog/exchange-rates
```

---

### 3.4. Invoicing Module

Permissions required: `read:invoices`, `write:invoices`, `read:payments`, `write:payments`, `read:subscriptions`, `write:subscriptions`

#### Issue a New Invoice (Draft or Sent)

```bash
./scripts/client.sh POST invoicing/invoices '{"client_id": "{client_uuid}", "status": "sent", "currency": "USD", "line_items": [{"product_id": "{product_uuid}", "quantity": 2.0}]}'
```

#### List Invoices

```bash
./scripts/client.sh GET invoicing/invoices
```

#### Get Invoice by ID

```bash
./scripts/client.sh GET invoicing/invoices/{id}
```

#### Update Invoice Status/Lifecycle

```bash
./scripts/client.sh PUT invoicing/invoices/{id} '{"status": "cancelled"}'
```

#### Delete Draft Invoice

```bash
./scripts/client.sh DELETE invoicing/invoices/{id}
```

#### Record Payment against Invoice

```bash
./scripts/client.sh POST invoicing/payments '{"invoice_id": "{invoice_uuid}", "amount": 100.00, "currency": "USD", "payment_method": "bank_transfer"}'
```

#### List Recorded Payments

```bash
./scripts/client.sh GET invoicing/payments
```

#### Create Subscription Contract

```bash
./scripts/client.sh POST invoicing/subscriptions '{"client_id": "{client_uuid}", "product_id": "{product_uuid}", "start_date": "2026-06-07"}'
```

#### List Subscriptions

```bash
./scripts/client.sh GET invoicing/subscriptions
```

#### Update Subscription lifecycle state

```bash
./scripts/client.sh PUT invoicing/subscriptions/{id} '{"status": "paused"}'
```

#### Terminate Subscription

```bash
./scripts/client.sh DELETE invoicing/subscriptions/{id}
```

---

### 3.5. Accounting Module

Permissions required: `read:accounts`, `write:accounts`, `read:journal_entries`, `write:journal_entries`, `reverse:journal`, `read:periods`, `write:periods`, `close:period`

#### Create Chart of Accounts element

```bash
./scripts/client.sh POST accounting/accounts '{"code": "1010", "name": "Petty Cash", "type": "asset", "currency": "USD"}'
```

#### List Chart of Accounts

```bash
./scripts/client.sh GET accounting/accounts
```

#### Post a Balanced Double-Entry Journal Entry

```bash
./scripts/client.sh POST accounting/journal-entries '{"date": "2026-06-07", "description": "Manual sales entry", "lines": [{"account_id": "{ar_acc_uuid}", "debit": 150.00, "credit": 0.0}, {"account_id": "{rev_acc_uuid}", "debit": 0.0, "credit": 150.00}]}'
```

#### List Journal Entries

```bash
./scripts/client.sh GET accounting/journal-entries
```

#### Reverse a Journal Entry

```bash
./scripts/client.sh POST accounting/journal-entries/{id}/reverse
```

#### Close a Financial Period (Prevents modifying postings)

```bash
./scripts/client.sh POST accounting/periods/close '{"start_date": "2026-05-01", "end_date": "2026-05-31", "notes": "May month close"}'
```

#### Get Trial Balance Report

```bash
./scripts/client.sh GET accounting/reports/trial-balance
```

#### Get Accounts Receivable Aging Report

```bash
./scripts/client.sh GET accounting/reports/aging
```

---

### 3.6. Inventory Module

Permissions required: `read:inventory`, `write:inventory`, `read:suppliers`, `write:suppliers`, `read:purchase_orders`, `write:purchase_orders`

#### Create a Supplier

```bash
./scripts/client.sh POST inventory/suppliers '{"name": "Global Tech Suppliers", "email": "sales@globaltech.com"}'
```

#### List Suppliers

```bash
./scripts/client.sh GET inventory/suppliers
```

#### Create a Purchase Order (PO)

```bash
./scripts/client.sh POST inventory/purchase-orders '{"supplier_id": "{supplier_uuid}", "line_items": [{"product_id": "{product_uuid}", "quantity": 100, "unit_cost": 15.00}]}'
```

#### List Purchase Orders

```bash
./scripts/client.sh GET inventory/purchase-orders
```

#### Receive Purchase Order Goods (Increments stock levels)

```bash
./scripts/client.sh POST inventory/purchase-orders/{id}/receive
```

#### Make Manual Stock Level Adjustment

```bash
./scripts/client.sh POST inventory/adjustments '{"product_id": "{product_uuid}", "quantity_change": -5.0, "reason_code": "damage", "notes": "damaged item"}'
```

#### List Stock Adjustments

```bash
./scripts/client.sh GET inventory/adjustments
# Filter by product_id:
./scripts/client.sh GET "inventory/adjustments?product_id={product_uuid}"
```

#### Get Current Stock Levels

```bash
./scripts/client.sh GET inventory/stock
```

#### Get Specific Product Stock Details

```bash
./scripts/client.sh GET inventory/stock/{productId}
```

---

### 3.7. HR & Payroll Module

Permissions required: `read:employees`, `write:employees`, `read:attendance`, `write:attendance`, `read:leaves`, `write:leaves`, `read:payroll`, `process:payroll`, `read:performance`, `write:performance`

#### Create an Employee (Defaults to onboarding status)

```bash
./scripts/client.sh POST hr/employees '{"first_name": "Alice", "last_name": "Smith", "start_date": "2026-06-01", "employment_type": "full_time", "base_salary": 3000.0, "currency": "USD"}'
```

#### List Employees

```bash
./scripts/client.sh GET hr/employees
```

#### Update Employee status / Details (Activate employee)

```bash
./scripts/client.sh PUT hr/employees/{id} '{"status": "active"}'
```

#### Delete Employee (Soft Delete)

```bash
./scripts/client.sh DELETE hr/employees/{id}
```

#### Attendance Clock In

```bash
./scripts/client.sh POST hr/attendance/clock-in '{"employee_id": "{employee_uuid}"}'
```

#### Attendance Clock Out

```bash
./scripts/client.sh POST hr/attendance/clock-out '{"employee_id": "{employee_uuid}"}'
```

#### List Attendance Records

```bash
./scripts/client.sh GET hr/attendance
```

#### Create a Leave Type

```bash
./scripts/client.sh POST hr/leave-types '{"name": "Vacation", "annual_entitlement": 15}'
```

#### List Leave Types

```bash
./scripts/client.sh GET hr/leave-types
```

#### Submit a Leave Request

```bash
./scripts/client.sh POST hr/leaves '{"employee_id": "{employee_uuid}", "leave_type_id": "{leave_type_uuid}", "start_date": "2026-12-01", "end_date": "2026-12-05", "reason": "Holiday"}'
```

#### List Leave Requests

```bash
./scripts/client.sh GET hr/leaves
```

#### Approve Leave Request

```bash
./scripts/client.sh POST hr/leaves/{id}/approve '{"manager_id": "{manager_employee_uuid}"}'
```

#### Reject Leave Request

```bash
./scripts/client.sh POST hr/leaves/{id}/reject '{"manager_id": "{manager_employee_uuid}"}'
```

#### Run Payroll (Triggers automated Ledger Entries)

```bash
./scripts/client.sh POST hr/payroll/run '{"period_start": "2026-06-01", "period_end": "2026-06-30"}'
```

#### List Payslips

```bash
./scripts/client.sh GET hr/payroll/payslips
```

#### Post a Performance Review

```bash
./scripts/client.sh POST hr/performance-reviews '{"employee_id": "{employee_uuid}", "reviewer_id": "{manager_uuid}", "review_period": "2026-Q2", "rating": 4.5, "feedback_notes": "Consistent delivery."}'
```

#### List Performance Reviews

```bash
./scripts/client.sh GET hr/performance-reviews
```

---

### 3.8. Webhooks Module

Permissions required: `read:webhooks`, `write:webhooks`

#### Register Webhook Subscription

```bash
./scripts/client.sh POST webhooks '{"url": "https://callback.mycompany.com/erp-events", "eventType": "invoice.sent"}'
```

#### List Webhook Subscriptions

```bash
./scripts/client.sh GET webhooks
```

#### Delete Webhook Subscription

```bash
./scripts/client.sh DELETE webhooks/{id}
```

---

### 3.9. Monitored Communications Module

Permissions required: `read:monitored_communications`, `write:monitored_communications`

#### Create a Monitored Communication Log

```bash
./scripts/client.sh POST monitored-communications '{"client_name": "Acme Corp", "contact_name": "John Doe", "channel": "email", "channel_address": "john@acme.com", "conversation_date": "2026-06-07T12:00:00Z"}'
```

#### List Monitored Communication Logs

```bash
./scripts/client.sh GET monitored-communications
```

#### Get Communication Log Details

```bash
./scripts/client.sh GET monitored-communications/{id}
```

#### Update a Communication Log

```bash
./scripts/client.sh PUT monitored-communications/{id} '{"client_name": "Acme LLC"}'
```

#### Delete a Communication Log

```bash
./scripts/client.sh DELETE monitored-communications/{id}
```

---

### 3.10. Documents Module

Permissions required: `read:documents`, `write:documents`

#### Create/Attach a Document to a Lead or Client

At least one of `lead_id` or `client_id` must be provided. The referenced lead/client must exist.

```bash
./scripts/client.sh POST documents '{"title": "Contract Agreement", "details": "Draft agreement for lead", "filepath": "/uploads/leads/contract.pdf", "lead_id": "{lead_uuid}"}'
```

#### List Documents

```bash
./scripts/client.sh GET documents
# Filter by lead_id:
./scripts/client.sh GET "documents?lead_id={lead_uuid}"
# Filter by client_id:
./scripts/client.sh GET "documents?client_id={client_uuid}"
```

#### Get Document Details

```bash
./scripts/client.sh GET documents/{id}
```

#### Delete Document

```bash
./scripts/client.sh DELETE documents/{id}
```

---

## 4. Verification & Testing

Verify your environment connection and configuration by querying the `/health` endpoint anonymously:

```bash
./scripts/client.sh GET health
```

Expected Response:

```json
{
  "status": "healthy",
  "timestamp": "2026-06-07T..."
}
```
