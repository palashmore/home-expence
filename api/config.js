// Configuration API Route (/api/config)
const fs = require('fs');
const path = require('path');
const cloudSync = require('./_cloud_sync');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  staff: [
    {
      id: "staff-1",
      name: "Chef - Nilima Nikose",
      shortName: "Nilima",
      role: "Chef / Cook",
      baseSalary: 4500,
      allowedPaidLeaves: 4,
      billingCycleDay: 30,
      cycleType: "calendar_month",
      active: true
    },
    {
      id: "staff-2",
      name: "Maid - Madhuri",
      shortName: "Madhuri",
      role: "Housemaid",
      baseSalary: 800,
      allowedPaidLeaves: 2,
      billingCycleDay: 21,
      cycleType: "custom_cycle",
      cycleStartDay: 21,
      active: true
    }
  ],
  categories: [
    { name: "Grocery & Vegetables", icon: "🛒", type: "expense", defaultPaidTo: "Blinkit" },
    { name: "Electricity Bill", icon: "⚡", type: "expense", defaultPaidTo: "MSCB / MSEDCL" },
    { name: "Flat Maintenance", icon: "🏢", type: "expense", defaultPaidTo: "Society Office" },
    { name: "Chef - Nilima Nikose", icon: "👩‍🍳", type: "expense", defaultPaidTo: "Nilima Nikose" },
    { name: "Maid - Madhuri", icon: "🧹", type: "expense", defaultPaidTo: "Madhuri" },
    { name: "Wifi & Internet", icon: "📶", type: "expense", defaultPaidTo: "Airtel" },
    { name: "Dish Bill (DTH)", icon: "📺", type: "expense", defaultPaidTo: "Tata Play" },
    { name: "Shopping & Miscellaneous", icon: "🛍️", type: "expense", defaultPaidTo: "Amazon" },
    { name: "Accepted Payments (Income)", icon: "💰", type: "income", defaultPaidTo: "" },
    { name: "Settlement / Transfer", icon: "🤝", type: "transfer", defaultPaidTo: "Pallavi" }
  ],
  recurringBills: [
    { id: "bill-1", name: "MSCB Electricity Bill", category: "Electricity Bill", dueDay: 10, approxAmount: 2200, icon: "⚡" },
    { id: "bill-2", name: "Society Flat Maintenance", category: "Flat Maintenance", dueDay: 5, approxAmount: 3500, icon: "🏢" },
    { id: "bill-3", name: "Airtel Broadband / Wifi", category: "Wifi & Internet", dueDay: 15, approxAmount: 999, icon: "📶" },
    { id: "bill-4", name: "Tata Play / Dish Bill", category: "Dish Bill (DTH)", dueDay: 20, approxAmount: 450, icon: "📺" },
    { id: "bill-5", name: "Maid - Madhuri Salary", category: "Maid - Madhuri", dueDay: 21, approxAmount: 800, icon: "🧹" },
    { id: "bill-6", name: "Chef - Nilima Salary", category: "Chef - Nilima Nikose", dueDay: 30, approxAmount: 4500, icon: "👩‍🍳" }
  ],
  familyMembers: ["Palash", "Pallavi", "Mom", "Dad"],
  paymentMethods: ["UPI / GPay / PhonePe", "Credit Card", "Net Banking", "Cash"],
  householdCycle: {
    type: "custom",
    cycleStartDay: 5,
    cycleEndDay: 5,
    description: "5th of current month to 5th of next month"
  }
};

const TMP_CONFIG = path.join('/tmp', 'config.json');

async function readConfig() {
  try {
    const cloudCfg = await cloudSync.readJson('config.json');
    if (cloudCfg && typeof cloudCfg === 'object' && cloudCfg.staff) {
      return cloudCfg;
    }
  } catch (e) {}

  try {
    if (fs.existsSync(TMP_CONFIG)) {
      const raw = fs.readFileSync(TMP_CONFIG, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {}

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      try { fs.writeFileSync(TMP_CONFIG, JSON.stringify(parsed, null, 2), 'utf8'); } catch (e) {}
      return parsed;
    }
  } catch (err) {
    console.warn('Error reading config.json:', err.message);
  }
  return DEFAULT_CONFIG;
}

async function writeConfig(data) {
  // 1. Write to cloud sync
  await cloudSync.writeJson('config.json', data);

  // 2. Write to local /tmp
  try {
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}

  // 3. Write to local data/ directory
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}

  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    if (req.method === 'GET') {
      const config = await readConfig();
      return res.status(200).json({
        success: true,
        data: config
      });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      if (!body) {
        return res.status(400).json({ success: false, error: 'Empty payload' });
      }

      const current = await readConfig();
      // Merge updates
      const updated = {
        ...current,
        ...body
      };

      await writeConfig(updated);

      // Audit Log Configuration Changes
      const diff = {};
      for (const key of Object.keys(body)) {
        diff[key] = { updated: true, summary: Array.isArray(body[key]) ? `${body[key].length} items` : typeof body[key] };
      }
      await cloudSync.logAudit('UPDATE_CONFIG', 'masterConfig', diff, {
        modifiedSections: Object.keys(body)
      });

      return res.status(200).json({
        success: true,
        message: 'Master configuration saved successfully',
        data: updated
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Config API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
};
