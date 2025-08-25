// api/quotes/health.js
export default function handler(req, res) {
  const ok =
    !!(process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY) &&
    !!process.env.AIRTABLE_BASE_ID &&
    !!process.env.TB_PREVENTIVI &&
    !!process.env.TB_OPZIONI;

  res.status(ok ? 200 : 500).json({
    ok,
    env: {
      AIRTABLE_BASE_ID: !!process.env.AIRTABLE_BASE_ID,
      TB_PREVENTIVI: process.env.TB_PREVENTIVI,
      TB_OPZIONI: process.env.TB_OPZIONI,
    },
  });
}
