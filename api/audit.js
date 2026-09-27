// Audit Trail API Route (/api/audit)
// Provides queryable history of all system edits, amount changes, and configuration updates
const { getAuditLogs, logAudit } = require('./_cloud_sync');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    if (req.method === 'GET') {
      const limit = req.query && req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const logs = await getAuditLogs(isNaN(limit) ? 100 : limit);
      return res.status(200).json({
        success: true,
        count: logs.length,
        data: logs
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Audit API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
};
