import { Router } from 'express';
import { searchBikes, getBikeById, isSpokesConfigured } from '../services/spokes';
import { sendBadRequest, sendUnauthorized, sendInternalError, sendNotFound } from '../lib/api-response';

const router = Router();

/**
 * GET /api/spokes/search
 * Search bikes via 99spokes API.
 *
 * Query params:
 *   q (required): Search query (min 2 chars)
 *   year (optional): Filter by model year
 *   category (optional): Filter by category (mountain, road, urban, bmx, youth)
 */
router.get('/search', async (req, res) => {
  try {
    if (!req.sessionUser?.uid) {
      return sendUnauthorized(res, 'Authentication required');
    }

    if (!isSpokesConfigured()) {
      return sendInternalError(res, 'Bike search is not configured');
    }

    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return sendBadRequest(res, 'Query must be at least 2 characters');
    }

    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const category = req.query.category as string | undefined;

    const results = await searchBikes({
      query,
      year: year && !isNaN(year) ? year : undefined,
      category,
      limit: 20,
    });

    res.json({ bikes: results });
  } catch (error) {
    console.error('[Spokes Route] Search error:', error);
    return sendInternalError(res, 'Failed to search bikes');
  }
});

/**
 * GET /api/spokes/bike/:id
 * Get full bike details including components and images.
 */
router.get('/bike/:id', async (req, res) => {
  try {
    if (!req.sessionUser?.uid) {
      return sendUnauthorized(res, 'Authentication required');
    }

    if (!isSpokesConfigured()) {
      return sendInternalError(res, 'Bike search is not configured');
    }

    const bikeId = req.params.id;
    if (!bikeId) {
      return sendBadRequest(res, 'Bike ID is required');
    }

    const bike = await getBikeById(bikeId);
    if (!bike) {
      return sendNotFound(res, 'Bike not found');
    }

    res.json({ bike });
  } catch (error) {
    console.error('[Spokes Route] Get bike error:', error);
    return sendInternalError(res, 'Failed to get bike details');
  }
});

export default router;
