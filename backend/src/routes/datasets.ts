import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 2_147_483_647;

function positiveInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export default async function datasetRoutes(fastify: FastifyInstance) {
  fastify.addHook('onClose', async () => prisma.$disconnect());

  fastify.get('/api/datasets/customers', async (request, reply) => {
    const { page: rawPage, limit: rawLimit } = request.query as { page?: unknown; limit?: unknown };
    const page = positiveInteger(rawPage, 1);
    const limit = positiveInteger(rawLimit, DEFAULT_LIMIT);

    if (page === null || limit === null || limit > MAX_LIMIT) {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_PAGINATION',
        message: `page must be a positive integer and limit must be between 1 and ${MAX_LIMIT}.`
      });
    }

    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip) || skip > MAX_OFFSET) {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_PAGINATION',
        message: 'Requested page is too large.'
      });
    }

    try {
      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          select: {
            id: true,
            preferredCurrency: true,
            accountStatus: true,
            totalBookings: true,
            successfulBookings: true,
            cancelledBookings: true
          },
          orderBy: { id: 'asc' },
          skip,
          take: limit
        }),
        prisma.customer.count()
      ]);

      return reply.send({
        data: customers,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to query Prisma customer dataset');
      return reply.status(500).send({
        success: false,
        error: 'DATASET_QUERY_FAILED',
        message: 'Could not retrieve the customer dataset.'
      });
    }
  });
}
