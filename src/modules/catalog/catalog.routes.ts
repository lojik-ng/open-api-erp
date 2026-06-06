import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CatalogService } from './catalog.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';
import { ForbiddenError } from '../../shared/errors';

export const catalogRouter = Router();

// Zod schemas for input validation
const ProductSchema = z.object({
  sku: z.string().min(1).optional().or(z.literal('')),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['subscription', 'one_time_service', 'one_time_product']),
  default_price: z.number().nonnegative(),
  currency: z.string().min(3).max(3).optional(),
  billing_interval: z.enum(['monthly', 'quarterly', 'annually']).optional().nullable(),
  tax_rate_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  requires_stock: z.boolean().optional(),
});

const TaxRateSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(1.0),
  is_default: z.boolean().optional(),
});

const ExchangeRateSchema = z.object({
  from_currency: z.string().min(3).max(3),
  to_currency: z.string().min(3).max(3),
  rate: z.number().positive(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

// Register OpenAPI schemas
const OpenAPIProduct = registry.register('Product', z.object({
  id: z.string().uuid(),
  sku: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  default_price: z.number(),
  currency: z.string(),
  billing_interval: z.string().nullable(),
  tax_rate_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  requires_stock: z.boolean(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPITaxRate = registry.register('TaxRate', z.object({
  id: z.string().uuid(),
  name: z.string(),
  rate: z.number(),
  is_default: z.boolean(),
  created_at: z.string(),
}));

// OpenAPI registrations
registry.registerPath({
  method: 'post',
  path: '/catalog/products',
  summary: 'Create a new product or service offering',
  tags: ['Catalog'],
  request: {
    body: { content: { 'application/json': { schema: ProductSchema } } },
  },
  responses: {
    201: { description: 'Product created', content: { 'application/json': { schema: OpenAPIProduct } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/catalog/products',
  summary: 'List products and services',
  tags: ['Catalog'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'include_deleted', in: 'query', schema: { type: 'boolean' } },
    { name: 'q', in: 'query', schema: { type: 'string' }, description: 'FTS5 search query' },
  ],
  responses: {
    200: {
      description: 'Paginated list of products',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIProduct),
            meta: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
          }),
        },
      },
    },
  },
});

// Express route handlers

// PRODUCTS
catalogRouter.post('/products', rbac('write:products'), audit('products'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ProductSchema.parse(req.body);
    if (validated.sku === '') validated.sku = undefined;

    const result = CatalogService.createProduct(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get('/products', rbac('read:products'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const q = req.query.q as string | undefined;
    const includeDeleted = req.query.include_deleted === 'true';

    if (includeDeleted && !req.assistant?.is_admin && !req.permissions?.includes('read:deleted')) {
      throw new ForbiddenError('read:deleted');
    }

    const result = CatalogService.listProducts({ cursor, limit, includeDeleted, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get('/products/:id', rbac('read:products', 'products'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CatalogService.getProductById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.put('/products/:id', rbac('write:products', 'products'), audit('products'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ProductSchema.partial().parse(req.body);
    if (validated.sku === '') validated.sku = undefined;

    const result = CatalogService.updateProduct(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.delete('/products/:id', rbac('write:products', 'products'), audit('products'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CatalogService.deleteProduct(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// TAX RATES
catalogRouter.post('/tax-rates', rbac('write:tax_rates'), audit('tax_rates'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = TaxRateSchema.parse(req.body);
    const result = CatalogService.createTaxRate(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get('/tax-rates', rbac('read:tax_rates'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CatalogService.listTaxRates();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// EXCHANGE RATES
catalogRouter.post('/exchange-rates', rbac('write:exchange_rates'), audit('exchange_rates'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ExchangeRateSchema.parse(req.body);
    const result = CatalogService.createExchangeRate(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get('/exchange-rates', rbac('read:exchange_rates'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CatalogService.listExchangeRates();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
