import { Router, Request, Response } from 'express';
import { commitmentSchema } from '../schemas/commitment';

export type OpenApiParameter = {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  schema: Record<string, unknown>;
};

export type OpenApiRequestBody = {
  description?: string;
  required?: boolean;
  content: {
    'application/json': {
      schema: Record<string, unknown>;
    };
  };
};

export type OpenApiResponse = {
  description: string;
  content?: {
    'application/json'?: {
      schema: Record<string, unknown>;
    };
    'text/plain'?: {
      schema: Record<string, unknown>;
    };
  };
};

export type OpenApiOperation = {
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
};

export type OpenApiPathItem = {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
};

export type OpenApiSpec = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: {
      name?: string;
      url?: string;
    };
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components: {
    schemas: Record<string, unknown>;
  };
};

/**
 * Converts a Zod Schema to an OpenAPI 3.0 Schema Object
 */
export function zodToOpenApiSchema(schema: any): Record<string, unknown> {
  if (!schema || !schema._def) {
    return { type: 'object' };
  }

  const def = schema._def;
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodString': {
      const res: Record<string, unknown> = { type: 'string' };
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') res.minLength = check.value;
          if (check.kind === 'max') res.maxLength = check.value;
          if (check.kind === 'datetime') res.format = 'date-time';
        }
      }
      return res;
    }
    case 'ZodNumber': {
      const res: Record<string, unknown> = { type: 'number' };
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') res.minimum = check.value;
          if (check.kind === 'max') res.maximum = check.value;
        }
      }
      return res;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
      };
    case 'ZodOptional':
      return zodToOpenApiSchema(def.innerType);
    case 'ZodNullable':
      return {
        ...zodToOpenApiSchema(def.innerType),
        nullable: true,
      };
    case 'ZodArray':
      return {
        type: 'array',
        items: zodToOpenApiSchema(def.type),
      };
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, propSchema] of Object.entries(shape as Record<string, any>)) {
        properties[key] = zodToOpenApiSchema(propSchema);
        if (propSchema._def?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      const out: Record<string, unknown> = {
        type: 'object',
        properties,
      };
      if (required.length > 0) {
        out.required = required;
      }
      return out;
    }
    default:
      return { type: 'string' };
  }
}

/**
 * Builds the complete OpenAPI 3.0 specification for Pactum Trust Layer API
 */
export function buildOpenApiSpec(): OpenApiSpec {
  const commitmentOpenApiSchema = zodToOpenApiSchema(commitmentSchema);

  return {
    openapi: '3.0.3',
    info: {
      title: 'Pactum Trust Layer API',
      version: '1.0.0',
      description:
        'OpenAPI 3.0 specification for Pactum Trust Layer — on-chain Soroban commitments, reputation scoring, and analytics.',
      contact: {
        name: 'Pactum Protocol Core Team',
        url: 'https://github.com/LynxXProtocol/Pactum',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment API Root',
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Service Health Check',
          description: 'Returns the health status and current server timestamp.',
          tags: ['System'],
          responses: {
            '200': {
              description: 'Service is operational',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                    required: ['status', 'timestamp'],
                  },
                },
              },
            },
          },
        },
      },
      '/metrics': {
        get: {
          summary: 'Prometheus Metrics Scraping Endpoint',
          description: 'Exposes Prometheus system and application metrics.',
          tags: ['System'],
          responses: {
            '200': {
              description: 'Prometheus metrics',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
      '/commitments': {
        get: {
          summary: 'List Commitments',
          description: 'Fetch and filter commitments across actors, status, or templates.',
          tags: ['Commitments'],
          parameters: [
            {
              name: 'template',
              in: 'query',
              description: 'Filter by commitment template',
              required: false,
              schema: {
                type: 'string',
                enum: ['Freeform', 'RefundDeposit', 'SLAGuarantee', 'MilestoneCheckIn'],
              },
            },
            {
              name: 'cursor',
              in: 'query',
              description: 'Pagination cursor for keyset pagination',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of items to return',
              required: false,
              schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            '200': {
              description: 'List of commitments',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      filter: { type: 'object' },
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Commitment' },
                      },
                      next_cursor: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create Commitment',
          description: 'Create a new on-chain or off-chain commitment.',
          tags: ['Commitments'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Commitment' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Commitment created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      data: { $ref: '#/components/schemas/Commitment' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                      details: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/commitments/{id}': {
        get: {
          summary: 'Get Commitment by ID',
          description: 'Retrieve detailed state of a commitment by ID.',
          tags: ['Commitments'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Commitment details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      id: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        put: {
          summary: 'Update Commitment by ID',
          description: 'Update the parameters or state of an existing commitment.',
          tags: ['Commitments'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Commitment' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Commitment updated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      data: { $ref: '#/components/schemas/Commitment' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/reputation/{address}': {
        get: {
          summary: 'Get Account Reputation',
          description: 'Query trust score and reputation summary for a Stellar address.',
          tags: ['Reputation'],
          parameters: [
            {
              name: 'address',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
            },
          ],
          responses: {
            '200': {
              description: 'Reputation score details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      address: { type: 'string' },
                      score: { type: 'number' },
                      tier: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/reputation/export/certificate': {
        post: {
          summary: 'Export Reputation Certificate (Verifiable Credential)',
          description: 'Generates a KMS-signed Verifiable Credential token for a DID.',
          tags: ['Reputation'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    did: { type: 'string', example: 'did:pactum:GABC123...' },
                    trustScore: { type: 'number', minimum: 0, maximum: 100 },
                  },
                  required: ['did', 'trustScore'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Certificate generated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      certificate: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/analytics': {
        get: {
          summary: 'Get Network Analytics',
          description: 'Aggregated analytics for commitments, volumes, and dispute ratios.',
          tags: ['Analytics'],
          responses: {
            '200': {
              description: 'Network analytics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Commitment: commitmentOpenApiSchema,
      },
    },
  };
}

/**
 * Creates Swagger UI HTML embedding the live OpenAPI JSON spec
 */
export function renderSwaggerHtml(specUrl = '/api-docs/json'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pactum Trust Layer — OpenAPI 3.0 Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.11.0/favicon-32x32.png" sizes="32x32" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
}

/**
 * Express router exposing Swagger UI and raw OpenAPI JSON
 */
export function createOpenApiRouter(): Router {
  const router = Router();
  const spec = buildOpenApiSpec();

  router.get('/json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(spec);
  });

  router.get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(renderSwaggerHtml('/api-docs/json'));
  });

  return router;
}
