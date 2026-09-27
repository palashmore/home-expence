// Script to push initial seed dataset to Google Sheet if Google Service Account credentials are provided
const { getAllExpenses } = require('./api/_db');
const { google } = require('googleapis');
require('dotenv').config();

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '136_A-7KiIQH78-nobASAfh0RA-EnrSk1';
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null;

async function syncToGoogleSheet() {
    if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
        console.log('Google Service Account credentials not provided in .env file.');
        console.log('Server is using embedded 116-record seed store. Once deployed to Vercel with Google secrets, records will sync automatically.');
        return;
    }

    try {
        console.log('Authenticating with Google Sheets API...');
        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets']
        );

        const sheets = google.sheets({ version: 'v4', auth });
        const expenses = await getAllExpenses();

        console.log(`Preparing to write ${expenses.length} records to Google Sheet ID: ${GOOGLE_SHEET_ID}`);

        const rows = [
            ['ID', 'Date', 'Category', 'Amount (INR)', 'Paid To / Vendor', 'Payment Method', 'Billing Cycle', 'Description', 'Receipt URL', 'Updated At'],
            ...expenses.map(exp => [
                exp.id,
                exp.date,
                exp.category,
                exp.amount,
                exp.vendor || '',
                exp.paymentMethod || 'UPI',
                exp.billingCycle || 'Standard',
                exp.description || '',
                exp.receiptUrl || '',
                exp.updatedAt || new Date().toISOString()
            ])
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Daily Expenses Log!A1:J' + (rows.length + 5),
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows }
        });

        console.log('✅ Successfully synced all 116 records to Google Sheet!');
    } catch (err) {
        console.error('Error syncing to Google Sheet:', err.message);
    }
}

syncToGoogleSheet();
