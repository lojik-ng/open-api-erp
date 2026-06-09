import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Register the standard ApiKeyAuth security scheme
registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
  description: 'SHA-256 hashed API key provided during assistant provisioning.'
});

/**
 * Generate the complete OpenAPI 3.0.0 specification document.
 */
export function getFullOpenAPISpec(): any {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Open API ERP',
      description: 'Comprehensive API specification for the AI-Managed CLI ERP System',
      version: '1.0.0',
    },
    servers: [{ url: '/v1' }],
    security: [{ ApiKeyAuth: [] }],
  });
}

/**
 * Generate a scoped OpenAPI specification document containing only the endpoints
 * the given assistant has permission to access.
 */
export function getScopedSpec(permissions: string[], isAdmin: boolean): any {
  const fullSpec = getFullOpenAPISpec();

  // Admins get the complete specification
  if (isAdmin || permissions.includes('*')) {
    return fullSpec;
  }

  const isAllowed = (path: string): boolean => {
    if (path === '/health') return true;

    if (path.startsWith('/crm/leads')) {
      return permissions.includes('read:leads') || permissions.includes('write:leads') || permissions.includes('convert:lead');
    }
    if (path.startsWith('/crm/clients')) {
      return permissions.includes('read:clients') || permissions.includes('write:clients');
    }
    if (path.startsWith('/crm/interactions')) {
      return permissions.includes('read:interactions') || permissions.includes('write:interactions');
    }
    if (path.startsWith('/crm/scheduled-events')) {
      return permissions.includes('read:scheduled_events') || permissions.includes('write:scheduled_events');
    }
    if (path.startsWith('/catalog/products')) {
      return permissions.includes('read:products') || permissions.includes('write:products');
    }
    if (path.startsWith('/invoicing/invoices') || path.startsWith('/invoicing/payments')) {
      return permissions.includes('read:invoices') || permissions.includes('write:invoices') || permissions.includes('read:payments') || permissions.includes('write:payments');
    }
    if (path.startsWith('/invoicing/subscriptions')) {
      return permissions.includes('read:subscriptions') || permissions.includes('write:subscriptions');
    }
    if (path.startsWith('/accounting/journal-entries')) {
      return permissions.includes('read:journal_entries') || permissions.includes('write:journal_entries') || permissions.includes('reverse:journal');
    }
    if (path.startsWith('/accounting/periods')) {
      return permissions.includes('read:periods') || permissions.includes('write:periods') || permissions.includes('close:period');
    }
    if (path.startsWith('/accounting/accounts')) {
      return permissions.includes('read:accounts') || permissions.includes('write:accounts');
    }
    if (path.startsWith('/inventory/')) {
      return permissions.includes('read:inventory') || permissions.includes('write:inventory') || permissions.includes('read:suppliers') || permissions.includes('write:suppliers') || permissions.includes('read:purchase_orders') || permissions.includes('write:purchase_orders');
    }
    if (path.startsWith('/hr/')) {
      return permissions.includes('read:employees') || permissions.includes('write:employees') || permissions.includes('read:attendance') || permissions.includes('write:attendance') || permissions.includes('read:leaves') || permissions.includes('write:leaves') || permissions.includes('read:payroll') || permissions.includes('process:payroll');
    }
    if (path.startsWith('/webhooks')) {
      return permissions.includes('read:webhooks') || permissions.includes('write:webhooks');
    }
    if (path.startsWith('/monitored-communications')) {
      return permissions.includes('read:monitored_communications') || permissions.includes('write:monitored_communications');
    }
    if (path.startsWith('/documents')) {
      return permissions.includes('read:documents') || permissions.includes('write:documents');
    }
    if (path.startsWith('/cold-marketing')) {
      return permissions.includes('read:cold_marketing') || permissions.includes('write:cold_marketing');
    }
    return false;
  };

  const scopedPaths: Record<string, any> = {};
  for (const [path, methods] of Object.entries(fullSpec.paths)) {
    if (isAllowed(path)) {
      scopedPaths[path] = methods;
    }
  }

  return {
    ...fullSpec,
    paths: scopedPaths
  };
}
