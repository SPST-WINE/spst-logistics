// /api/quotes/create.js
import Airtable from 'airtable';
import { nanoid } from 'nanoid';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = req.body || {};
    const quoteId = nanoid(10);
    const publicSlug = `${quoteId}-${Date.now().toString(36)}`;

    const table = process.env.AIRTABLE_QUOTES_TABLE; // es. "Quotes"
    const [created] = await base(table).create([{
      fields: {
        quote_id: quoteId,
        customer_email: body?.customer?.email || '',
        currency: body?.customer?.currency || 'EUR',
        valid_until: body?.customer?.validUntil || null,
        customer_notes: body?.customer?.notes || '',
        terms_version: body?.terms?.version || 'v1.0',
        visibility: body?.terms?.visibility || 'public',
        public_slug: publicSlug,
        status: 'draft'
      }
    }]);

    // TODO: creare records in "QuoteOptions" collegati a created.id

    return res.status(201).json({ quoteId, publicSlug, airtableId: created.id });
  } catch (e) {
    return res.status(500).json({ error: 'create_failed' });
  }
}
