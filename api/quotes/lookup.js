// /api/quotes/lookup.js
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const email = String(req.query.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'email_required' });

  const domainPart = email.includes('@') ? email.split('@')[1] : email;
  const domainKey = domainPart.split('.')[0]; // es. selladellespine

  try {
    const table = process.env.AIRTABLE_SENDER_TABLE; // es. "Customers"
    const records = await base(table)
      .select({ filterByFormula: `{domain_key} = '${domainKey}'`, maxRecords: 1 })
      .firstPage();

    if (!records.length) return res.status(204).end();
    const f = records[0].fields;
    return res.json({
      sender_name: f.sender_name || f.name || '',
      sender_country: f.sender_country || f.country || '',
      sender_city: f.sender_city || f.city || '',
      sender_zip: f.sender_zip || f.zip || '',
      sender_address: f.sender_address || f.address || '',
      sender_phone: f.sender_phone || f.phone || '',
      sender_tax: f.sender_tax || f.tax_id || ''
    });
  } catch (e) {
    return res.status(500).json({ error: 'lookup_failed' });
  }
}
