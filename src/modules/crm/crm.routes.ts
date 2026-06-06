import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CrmService } from './crm.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';
import { ForbiddenError } from '../../shared/errors';

export const crmRouter = Router();

// Zod validation schemas
const LeadSchema = z.object({
  source: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  company_name: z.string().optional(),
  stage: z.enum(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']).optional(),
  assigned_assistant_id: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().optional(),
});

const ClientSchema = z.object({
  type: z.enum(['b2c', 'b2b']),
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'churned']).optional(),
  lead_id: z.string().uuid().optional(),
  currency: z.string().min(3).max(3).optional(),
});

const ContactSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  role: z.string().optional(),
  is_primary: z.boolean().optional(),
});

const InteractionSchema = z.object({
  lead_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  type: z.enum(['call', 'email', 'meeting', 'note', 'other']),
  subject: z.string().optional(),
  body: z.string().optional(),
  interaction_date: z.string().optional(),
});

const EventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  event_type: z.enum(['meeting', 'call', 'task', 'reminder', 'other']),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  lead_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});

// Register OpenAPI schemas
const OpenAPILead = registry.register('Lead', z.object({
  id: z.string().uuid(),
  source: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company_name: z.string().nullable(),
  stage: z.string(),
  assigned_assistant_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  converted_client_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPIClient = registry.register('Client', z.object({
  id: z.string().uuid(),
  type: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  status: z.string(),
  lead_id: z.string().uuid().nullable(),
  currency: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

// OpenAPI routes registration
registry.registerPath({
  method: 'post',
  path: '/crm/leads',
  summary: 'Create a new lead',
  tags: ['CRM'],
  request: {
    body: { content: { 'application/json': { schema: LeadSchema } } },
  },
  responses: {
    201: { description: 'Lead created', content: { 'application/json': { schema: OpenAPILead } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/crm/leads',
  summary: 'List and search leads',
  tags: ['CRM'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'q', in: 'query', schema: { type: 'string' }, description: 'FTS5 search query' },
  ],
  responses: {
    200: {
      description: 'Paginated list of leads',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPILead),
            meta: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/crm/leads/{id}/convert',
  summary: 'Convert lead to client',
  tags: ['CRM'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: {
    200: { description: 'Converted client object', content: { 'application/json': { schema: OpenAPIClient } } },
  },
});

// Express route handlers

// LEADS
crmRouter.post('/leads', rbac('write:leads'), audit('leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeadSchema.parse(req.body);
    // clean empty strings
    if (validated.assigned_assistant_id === '') validated.assigned_assistant_id = undefined;
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.createLead(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/leads', rbac('read:leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const q = req.query.q as string | undefined;
    const result = CrmService.listLeads({ cursor, limit, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/leads/:id', rbac('read:leads', 'leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.getLeadById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.put('/leads/:id', rbac('write:leads', 'leads'), audit('leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeadSchema.partial().parse(req.body);
    if (validated.assigned_assistant_id === '') validated.assigned_assistant_id = undefined;
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.updateLead(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.delete('/leads/:id', rbac('write:leads', 'leads'), audit('leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.deleteLead(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.post('/leads/:id/convert', rbac('convert:lead', 'leads'), audit('leads'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.convertLead(req.params.id, req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CLIENTS
crmRouter.post('/clients', rbac('write:clients'), audit('clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ClientSchema.parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.createClient(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/clients', rbac('read:clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const q = req.query.q as string | undefined;
    const includeDeleted = req.query.include_deleted === 'true';

    // Verify read:deleted permission if including deleted
    if (includeDeleted && !req.assistant?.is_admin && !req.permissions?.includes('read:deleted')) {
      throw new ForbiddenError('read:deleted');
    }

    const result = CrmService.listClients({ cursor, limit, includeDeleted, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/clients/:id', rbac('read:clients', 'clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.getClientById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.put('/clients/:id', rbac('write:clients', 'clients'), audit('clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ClientSchema.partial().parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.updateClient(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.delete('/clients/:id', rbac('write:clients', 'clients'), audit('clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.deleteClient(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CLIENT CONTACT PERSONS
crmRouter.post('/clients/:clientId/contacts', rbac('write:clients', 'clients'), audit('contact_persons'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ContactSchema.parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.createContact(req.params.clientId, validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/clients/:clientId/contacts', rbac('read:clients', 'clients'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.listContacts(req.params.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.put('/contacts/:id', rbac('write:clients'), audit('contact_persons'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ContactSchema.partial().parse(req.body);
    if (validated.email === '') validated.email = undefined;

    const result = CrmService.updateContact(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.delete('/contacts/:id', rbac('write:clients'), audit('contact_persons'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.deleteContact(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// COMMUNICATIONS / INTERACTIONS
crmRouter.post('/interactions', rbac('write:interactions'), audit('interactions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = InteractionSchema.parse(req.body);
    const result = CrmService.createInteraction(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/interactions', rbac('read:interactions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const lead_id = req.query.lead_id as string | undefined;
    const client_id = req.query.client_id as string | undefined;
    const result = CrmService.listInteractions({ lead_id, client_id, limit, cursor });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// EVENTS / SCHEDULING
crmRouter.post('/scheduled-events', rbac('write:scheduled_events'), audit('scheduled_events'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = EventSchema.parse(req.body);
    const result = CrmService.createEvent(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.get('/scheduled-events', rbac('read:scheduled_events'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const lead_id = req.query.lead_id as string | undefined;
    const client_id = req.query.client_id as string | undefined;
    const employee_id = req.query.employee_id as string | undefined;
    const result = CrmService.listEvents({ lead_id, client_id, employee_id, limit, cursor });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.put('/scheduled-events/:id', rbac('write:scheduled_events'), audit('scheduled_events'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = EventSchema.partial().parse(req.body);
    const result = CrmService.updateEvent(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

crmRouter.delete('/scheduled-events/:id', rbac('write:scheduled_events'), audit('scheduled_events'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = CrmService.deleteEvent(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
