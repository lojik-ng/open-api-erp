# Role-Based Access Control (RBAC) Matrix

This document defines the permission matrix for the CLI AI Assistants operating the Syllabux API-Only ERP system. Because AI assistants are autonomous, granular and strict RBAC is essential to prevent unintended cross-module data manipulation.

## 1. Core Assistant Personas (Roles)

While permissions are granted on a granular string basis (e.g., `read:invoices`, `write:clients`), they are logically grouped into the following personas for easier provisioning:

1. **System Admin Assistant**: Superuser. Has absolute access to all modules, system configuration, and assistant provisioning.
2. **Sales / CRM Assistant**: Manages the top-of-funnel pipeline, converts leads, and maintains client relationships.
3. **Finance / Accounting Assistant**: Handles billing, accounts receivable/payable, general ledger, and period closes.
4. **Inventory / Procurement Assistant**: Manages product catalogs, stock levels, and supplier purchasing.
5. **HR Assistant**: Manages employee lifecycles, time tracking, and payroll.
6. **Support Assistant**: Handles client inquiries, requiring read access to client history and write access to interaction logs.
7. **Internal Employee Assistant**: A self-service bot for company staff to log attendance, request time off, and view their own payslips (heavily restricted via row-level scoping).

---

## 2. Permission Matrix

The following matrix maps granular permissions to the standard assistant personas. 

**Legend:**
- 🔴 **None**: No access.
- 🟡 **R**: Read-only access (grants `read:{resource}`).
- 🟢 **R/W**: Read and Write access (grants `read:{resource}` and `write:{resource}`).
- 🟣 **Special**: Custom action permission (grants specific verb string).

### Core Infrastructure & Security
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `assistants` | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| `audit_logs` | 🟡 R | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| `documents` | 🟢 R/W | 🟢 R/W | 🟢 R/W | 🟢 R/W | 🟢 R/W | 🟡 R | 🟡 R |
| `read:deleted` | 🟣 Yes | 🔴 | 🟣 Yes | 🔴 | 🔴 | 🔴 |

### CRM Module
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `leads` | 🟢 R/W | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| `clients` | 🟢 R/W | 🟢 R/W | 🟡 R | 🔴 | 🔴 | 🟡 R | 🔴 |
| `contact_persons`| 🟢 R/W | 🟢 R/W | 🟡 R | 🔴 | 🔴 | 🟡 R | 🔴 |
| `interactions` | 🟢 R/W | 🟢 R/W | 🟡 R | 🔴 | 🔴 | 🟢 R/W | 🔴 |
| `scheduled_events` | 🟢 R/W | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🟡 R | 🔴 |

### Catalog Module
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `products` | 🟢 R/W | 🟡 R | 🟡 R | 🟢 R/W | 🔴 | 🟡 R | 🔴 |
| `tax_rates` | 🟢 R/W | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 |
| `exchange_rates` | 🟢 R/W | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 |

### Invoicing & Subscriptions
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `invoices` | 🟢 R/W | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🟡 R | 🔴 |
| `payments` | 🟢 R/W | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🟡 R | 🔴 |
| `subscriptions` | 🟢 R/W | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🟡 R | 🔴 |

### Accounting Module
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `accounts` | 🟢 R/W | 🔴 | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 |
| `journal_entries` | 🟢 R/W | 🔴 | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 |
| `periods` | 🟢 R/W | 🔴 | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🔴 |

### Inventory & Procurement
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `inventory` | 🟢 R/W | 🟡 R | 🔴 | 🟢 R/W | 🔴 | 🟡 R | 🔴 |
| `stock_adjustments` | 🟢 R/W | 🔴 | 🔴 | 🟢 R/W | 🔴 | 🔴 | 🔴 |
| `suppliers` | 🟢 R/W | 🔴 | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🔴 |
| `purchase_orders` | 🟢 R/W | 🔴 | 🟡 R | 🟢 R/W | 🔴 | 🔴 | 🔴 |

### HR & Payroll
| Permission Scope | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `employees` | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🟢 R/W | 🔴 | 🟡 R* |
| `attendance` | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🟢 R/W | 🔴 | 🟢 R/W* |
| `leaves` | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🟢 R/W | 🔴 | 🟢 R/W* |
| `performance` | 🟢 R/W | 🔴 | 🔴 | 🔴 | 🟢 R/W | 🔴 | 🟡 R* |
| `payroll` | 🟢 R/W | 🔴 | 🟡 R | 🔴 | 🟢 R/W | 🔴 | 🟡 R* |

*\*Employee permissions are strictly bound by row-level scoping to their own employee ID.*

### Special Business Actions
These actions correspond to specific, highly sensitive business workflows and require explicit string grants.
| Action Permission | Admin | Sales | Finance | Inventory | HR | Support | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `read:deleted` | 🟣 Yes | 🔴 | 🟣 Yes | 🔴 | 🔴 | 🔴 | 🔴 |
| `convert:lead` | 🟣 Yes | 🟣 Yes | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| `reverse:journal` | 🟣 Yes | 🔴 | 🟣 Yes | 🔴 | 🔴 | 🔴 | 🔴 |
| `close:period` | 🟣 Yes | 🔴 | 🟣 Yes | 🔴 | 🔴 | 🔴 | 🔴 |
| `process:payroll` | 🟣 Yes | 🔴 | 🔴 | 🔴 | 🟣 Yes | 🔴 | 🔴 |

---

## 3. Scoped Access (Phase 5)

While Phase 1-4 implements module-level permissions (e.g., "Can this assistant read invoices?"), **Phase 5** introduces Row-Level Scoping via the `assistant_scopes` table. 

When scoping is applied to an assistant, their global module permissions are intersected with their assigned scopes.

**Examples of Row-Level Scoping:**
1. **Dedicated Account Manager**: A CRM assistant has `write:clients` but is scoped *only* to `client_id = X` and `client_id = Y`. They cannot view or modify Client Z.
2. **Regional Inventory Bot**: An Inventory assistant has `write:inventory` but is scoped to `location = 'Warehouse_EU'`. It cannot view or adjust stock in US warehouses.
3. **Self-Service Employee Bot**: An internal HR assistant designed for employees to check their own balances. It has `read:leaves` but is scoped to the specific `employee_id` chatting with it.

Row-Level Scoping applies seamlessly via database query filters injected by the Auth middleware before executing the handler.
