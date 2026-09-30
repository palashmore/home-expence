#!/usr/bin/env node
// Prints the secrets a deployment needs. Nothing is written to disk and nothing
// is sent anywhere - copy the output straight into your host's environment
// variable settings.
//
//   npm run keys
const crypto = require('crypto');

let vapid = null;
try {
    vapid = require('web-push').generateVAPIDKeys();
} catch (e) {
    // web-push is a dependency, but do not fail the whole command if it is
    // missing - JWT_SECRET is the one that blocks login.
}

const jwtSecret = crypto.randomBytes(48).toString('base64url');

console.log('');
console.log('Paste these into your environment variables (Vercel: Settings ->');
console.log('Environment Variables), then redeploy. Keep them secret.');
console.log('');
console.log(`JWT_SECRET=${jwtSecret}`);

if (vapid) {
    console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
    console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
} else {
    console.log('');
    console.log('VAPID keys were skipped: run `npm install` first, then re-run.');
}

console.log('');
console.log('Notes:');
console.log('  - changing JWT_SECRET signs everyone out');
console.log('  - changing the VAPID keys makes every device re-enable notifications');
console.log('  - never commit these, and generate new ones if they are ever exposed');
console.log('');
