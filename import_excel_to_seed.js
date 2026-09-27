const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const DOWNLOADS_DIR = 'C:\\Users\\Palash\\Downloads';
const DB_FILE_PATH = path.join(__dirname, 'api', '_db.js');

// Candidate Excel files specified by user or found in Downloads
const candidateFiles = [
    'C:\\Users\\Palash\\Downloads\\Household_Expenses_Database_2026-09-24 (1) (1).xlsx',
    'C:\\Users\\Palash\\Downloads\\Household_Expenses_Database_2026-09-24 (1).xlsx',
    'C:\\Users\\Palash\\Downloads\\Household_Expenses_Database_2026-09-24.xlsx'
];

// Dynamically discover all matching Excel files in Downloads
if (fs.existsSync(DOWNLOADS_DIR)) {
    const filesInDownloads = fs.readdirSync(DOWNLOADS_DIR);
    filesInDownloads.forEach(file => {
        if (file.toLowerCase().includes('household_expenses_database') && file.endsWith('.xlsx')) {
            const fullPath = path.join(DOWNLOADS_DIR, file);
            if (!candidateFiles.includes(fullPath)) {
                candidateFiles.push(fullPath);
            }
        }
    });
}

const existingFiles = candidateFiles.filter(f => fs.existsSync(f));
console.log('Found matching Excel files to process:', existingFiles);

if (existingFiles.length === 0) {
    console.error('No Excel files found!');
    process.exit(1);
}

const formattedExpenses = [];
const seenFingerprints = new Set();
let idCounter = 1;

existingFiles.forEach(excelPath => {
    console.log(`\n--- Reading Excel File: ${path.basename(excelPath)} ---`);
    try {
        const wb = xlsx.readFile(excelPath);
        
        // Process all sheets or primary sheet
        const sheetNames = wb.SheetNames;
        console.log('Sheet Names:', sheetNames);

        // Process Daily Expenses Log
        const dailyLogSheet = wb.Sheets['Daily Expenses Log'] || wb.Sheets[sheetNames[0]];
        const dailyLog = dailyLogSheet ? xlsx.utils.sheet_to_json(dailyLogSheet) : [];
        console.log(`Daily Expenses Log rows: ${dailyLog.length}`);

        dailyLog.forEach((row) => {
            let rawDate = row['Date'];
            if (typeof rawDate === 'number') {
                const parsed = xlsx.SSF.parse_date_code(rawDate);
                const yyyy = parsed.y;
                const mm = String(parsed.m).padStart(2, '0');
                const dd = String(parsed.d).padStart(2, '0');
                rawDate = `${yyyy}-${mm}-${dd}`;
            } else if (rawDate && rawDate.includes('/')) {
                const parts = rawDate.split('/');
                if (parts.length === 3) {
                    rawDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
            }

            const date = String(rawDate || new Date().toISOString().split('T')[0]).trim();
            const category = String(row['Expense Category'] || 'Shopping & Miscellaneous').trim();
            const amount = Number(row['Amount (INR)']) || 0;
            const vendor = String(row['Paid To / Vendor'] || '').trim();
            const paymentMethod = String(row['Payment Method'] || 'UPI').trim();
            const description = String(row['Notes / Description'] || '').trim();

            let billingCycle = 'Standard';
            if (category.includes('Madhuri')) {
                billingCycle = '21st (21st to 20th next month)';
            } else if (category.includes('Nilima')) {
                billingCycle = '30th (30th to 29th next month)';
            }

            const fingerprint = `${date}_${category}_${amount}_${description.substring(0, 15)}`;
            if (!seenFingerprints.has(fingerprint) && amount > 0) {
                seenFingerprints.add(fingerprint);
                formattedExpenses.push({
                    id: `exp-${String(idCounter++).padStart(3, '0')}`,
                    date: date,
                    category: category,
                    amount: amount,
                    vendor: vendor,
                    paymentMethod: paymentMethod,
                    billingCycle: billingCycle,
                    description: description,
                    receiptUrl: '',
                    updatedAt: new Date().toISOString()
                });
            }
        });

        // Process Staff Payments Ledger
        if (wb.Sheets['Staff Payments Ledger']) {
            const staffLedger = xlsx.utils.sheet_to_json(wb.Sheets['Staff Payments Ledger']);
            console.log(`Staff Payments Ledger rows: ${staffLedger.length}`);

            staffLedger.forEach((row) => {
                let rawDate = row['Payment Date'];
                if (typeof rawDate === 'number') {
                    const parsed = xlsx.SSF.parse_date_code(rawDate);
                    rawDate = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
                }

                const date = String(rawDate || new Date().toISOString().split('T')[0]).trim();
                const staffMember = String(row['Staff Member'] || '');
                let category = 'Shopping & Miscellaneous';
                let billingCycle = 'Standard';

                if (staffMember.toLowerCase().includes('madhuri')) {
                    category = 'Maid - Madhuri';
                    billingCycle = '21st (21st to 20th next month)';
                } else if (staffMember.toLowerCase().includes('nilima')) {
                    category = 'Chef - Nilima Nikose';
                    billingCycle = '30th (30th to 29th next month)';
                }

                const amount = Number(row['Amount Paid (INR)']) || 0;
                const paymentMethod = String(row['Payment Method'] || 'UPI').trim();
                const description = String(row['Remarks'] || `Payment for ${row['For Month'] || ''}`).trim();

                const fingerprint = `${date}_${category}_${amount}_${description.substring(0, 15)}`;
                if (!seenFingerprints.has(fingerprint) && amount > 0) {
                    seenFingerprints.add(fingerprint);
                    formattedExpenses.push({
                        id: `exp-${String(idCounter++).padStart(3, '0')}`,
                        date: date,
                        category: category,
                        amount: amount,
                        vendor: staffMember,
                        paymentMethod: paymentMethod,
                        billingCycle: billingCycle,
                        description: description,
                        receiptUrl: '',
                        updatedAt: new Date().toISOString()
                    });
                }
            });
        }
    } catch (e) {
        console.error(`Error reading ${excelPath}:`, e.message);
    }
});

// Sort expenses chronologically descending (newest first)
formattedExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

console.log(`\n======================================================`);
console.log(`TOTAL UNIQUE MERGED TRANSACTIONS: ${formattedExpenses.length}`);
const totalSum = formattedExpenses.reduce((sum, e) => sum + e.amount, 0);
console.log(`TOTAL EXPENDITURE / INCOME SUM: ₹${totalSum.toFixed(2)}`);
console.log(`======================================================\n`);

// Save to initial_expenses.json
const jsonPath = path.join(__dirname, 'initial_expenses.json');
fs.writeFileSync(jsonPath, JSON.stringify(formattedExpenses, null, 2));

// Update api/_db.js with the new seed array
let dbContent = fs.readFileSync(DB_FILE_PATH, 'utf8');
const seedRegex = /const INITIAL_SEED = \[[\s\S]*?\];/;
const newSeedStr = `const INITIAL_SEED = ${JSON.stringify(formattedExpenses, null, 4)};`;

if (seedRegex.test(dbContent)) {
    dbContent = dbContent.replace(seedRegex, newSeedStr);
    fs.writeFileSync(DB_FILE_PATH, dbContent);
    console.log(`Successfully updated INITIAL_SEED in api/_db.js with all ${formattedExpenses.length} transactions!`);
} else {
    console.error('Could not find INITIAL_SEED array in api/_db.js');
}
