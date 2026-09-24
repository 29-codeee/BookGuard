import { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';

const CATEGORIES = ['hotel', 'stay', 'airbnb', 'bus', 'train'] as const;

export default async function referenceDataRoutes(fastify: FastifyInstance) {
  fastify.get('/api/reference-data/summary', async () => {
    const result = await query<{ category: string; count: number; sources: string[] }>(`
      SELECT category, COUNT(*)::int AS count, ARRAY_AGG(DISTINCT source) AS sources
      FROM travel_reference_data GROUP BY category
    `);
    const found = new Map(result.rows.map(row => [row.category, row]));
    return {
      success: true,
      dataType: 'reference_only_not_bookable',
      categories: CATEGORIES.map(category => ({
        category,
        count: found.get(category)?.count ?? 0,
        sources: found.get(category)?.sources ?? [],
        status: found.has(category) ? 'loaded' : category === 'airbnb' ? 'awaiting_accessible_dataset' : 'not_loaded'
      }))
    };
  });

  fastify.get('/api/reference-data', async (req, reply) => {
    const { category, q, limit: rawLimit } = req.query as { category?: string; q?: string; limit?: string };
    if (category && !CATEGORIES.includes(category as typeof CATEGORIES[number])) {
      return reply.status(400).send({ success: false, error: 'INVALID_CATEGORY', message: 'Choose hotel, stay, airbnb, bus, or train.' });
    }
    const limit = Math.max(1, Math.min(Number(rawLimit) || 50, 200));
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conditions.push(`(name ILIKE ${p} OR city ILIKE ${p} OR location ILIKE ${p} OR origin ILIKE ${p} OR destination ILIKE ${p})`);
    }
    params.push(limit);
    const result = await query(`
      SELECT id, category, name, city, location, origin, destination, details, source
      FROM travel_reference_data ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY category, city NULLS LAST, name LIMIT $${params.length}
    `, params);
    return reply.send({ success: true, dataType: 'reference_only_not_bookable', items: result.rows });
  });
}
