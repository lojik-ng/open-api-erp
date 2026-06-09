import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { InventoryService } from './inventory.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const inventoryRouter = Router();

// Zod validation schemas
const StockAdjustmentSchema = z.object({
  product_id: z.string().uuid(),
  quantity_change: z.number(),
  reason_code: z.enum(['manual_correction', 'damage', 'return', 'received']),
  notes: z.string().optional(),
});

const SupplierSchema = z.object({
  name: z.string().min(1),
  contact_name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  payment_terms: z.string().optional(),
});

const POLineSchema = z.object({
  product_id: z.string().uuid(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
});

const CreatePOSchema = z.object({
  supplier_id: z.string().uuid(),
  currency: z.string().min(3).max(3).optional(),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  expected_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  line_items: z.array(POLineSchema).min(1, 'Purchase Order must have at least one line item'),
});

// Register OpenAPI schemas
const OpenAPIStock = registry.register('InventoryStock', z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity_on_hand: z.number(),
  low_stock_threshold: z.number(),
  location: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  sku: z.string().nullable(),
  product_name: z.string(),
}));

const OpenAPISupplier = registry.register('Supplier', z.object({
  id: z.string().uuid(),
  name: z.string(),
  contact_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  payment_terms: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPIPOLine = registry.register('POLine', z.object({
  id: z.string().uuid(),
  purchase_order_id: z.string().uuid(),
  product_id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  total_amount: z.number(),
}));

const OpenAPIPurchaseOrder = registry.register('PurchaseOrder', z.object({
  id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  status: z.string(),
  total_amount: z.number(),
  currency: z.string(),
  order_date: z.string(),
  expected_delivery_date: z.string().nullable(),
  assistant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  line_items: z.array(OpenAPIPOLine).optional(),
}));

const OpenAPIStockAdjustment = registry.register('StockAdjustment', z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity_change: z.number(),
  reason_code: z.string(),
  notes: z.string().nullable(),
  assistant_id: z.string().uuid(),
  created_at: z.string(),
}));

// OpenAPI registrations
registry.registerPath({
  method: 'get',
  path: '/inventory/stock',
  summary: 'List current stock levels',
  tags: ['Inventory'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated stock details',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIStock),
            meta: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/inventory/stock/{productId}',
  summary: 'Get stock details for a product',
  tags: ['Inventory'],
  parameters: [
    { name: 'productId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Stock level details for the product',
      content: {
        'application/json': { schema: OpenAPIStock },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/inventory/adjustments',
  summary: 'Create a stock adjustment',
  tags: ['Inventory'],
  request: {
    body: { content: { 'application/json': { schema: StockAdjustmentSchema } } },
  },
  responses: {
    201: {
      description: 'Stock adjustment logged successfully',
      content: {
        'application/json': { schema: OpenAPIStockAdjustment },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/inventory/adjustments',
  summary: 'List stock adjustments',
  tags: ['Inventory'],
  parameters: [
    { name: 'product_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'List of stock adjustments',
      content: {
        'application/json': {
          schema: z.array(OpenAPIStockAdjustment),
        },
      },
    },
  },
});

// Express route handlers

// STOCK & ADJUSTMENTS
inventoryRouter.get('/stock', rbac('read:inventory'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = InventoryService.listStock(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/stock/:productId', rbac('read:inventory'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.getStockByProductId(req.params.productId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post('/adjustments', rbac('write:inventory'), audit('stock_adjustments'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = StockAdjustmentSchema.parse(req.body);
    const result = InventoryService.createAdjustment(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/adjustments', rbac('read:inventory'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const product_id = req.query.product_id as string | undefined;
    const result = InventoryService.listAdjustments(product_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// SUPPLIERS
inventoryRouter.post('/suppliers', rbac('write:suppliers'), audit('suppliers'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = SupplierSchema.parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = InventoryService.createSupplier(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/suppliers', rbac('read:suppliers'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.listSuppliers();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.put('/suppliers/:id', rbac('write:suppliers'), audit('suppliers'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = SupplierSchema.partial().parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = InventoryService.updateSupplier(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.delete('/suppliers/:id', rbac('write:suppliers'), audit('suppliers'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.deleteSupplier(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PURCHASE ORDERS
inventoryRouter.post('/purchase-orders', rbac('write:purchase_orders'), audit('purchase_orders'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreatePOSchema.parse(req.body);
    const result = InventoryService.createPurchaseOrder(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/purchase-orders', rbac('read:purchase_orders'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.listPurchaseOrders();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.get('/purchase-orders/:id', rbac('read:purchase_orders'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.getPurchaseOrderById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post('/purchase-orders/:id/receive', rbac('write:purchase_orders'), audit('purchase_orders'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InventoryService.receiveGoods(req.params.id, req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
