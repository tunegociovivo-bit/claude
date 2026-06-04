'use strict';
// gen-ios-creds.js - Generate Apple Distribution Certificate and Provisioning Profile via ASC API
// Runs in the CI workflow working directory (apps/bubui-mobile)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const ASC_KEY_ID = process.env.ASC_KEY_ID;
const ASC_ISSUER_ID = process.env.ASC_ISSUER_ID;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp';
const BUNDLE_ID = 'com.negociovivo.bubui';
const CERT_PASSWORD = 'bubui2026';
const CREDS_DIR = path.join(process.cwd(), 'ios-creds');

if (!ASC_KEY_ID || !ASC_ISSUER_ID || !APPLE_TEAM_ID) {
  console.error('Missing required env vars: ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID');
  process.exit(1);
}

// Read ASC API key
const p8Key = fs.readFileSync(path.join(RUNNER_TEMP, 'asc-api-key.p8'), 'utf8');

// Generate JWT for ASC API
function generateJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1'
  })).toString('base64url');
  const sigInput = header + '.' + payload;
  const sign = crypto.createSign('SHA256');
  sign.update(sigInput);
  const sig = sign.sign({ key: p8Key, dsaEncoding: 'ieee-p1363' }, 'base64url');
  return sigInput + '.' + sig;
}

// HTTP request helper
function apiRequest(method, path, body, jwt) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.appstoreconnect.apple.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + jwt,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  fs.mkdirSync(CREDS_DIR, { recursive: true });
  const jwt = generateJWT();
  console.log('JWT generated for key:', ASC_KEY_ID);

  // Step 1: Generate private key and CSR using openssl
  console.log('Generating private key and CSR...');
  const keyPath = path.join(CREDS_DIR, 'dist.key');
  const csrPath = path.join(CREDS_DIR, 'dist.csr');
  execSync(`openssl genrsa -out ${keyPath} 2048`);
  execSync(`openssl req -new -key ${keyPath} -out ${csrPath} -subj '/CN=iPhone Distribution/O=Negocio Vivo/C=ES'`);
  const csrContent = fs.readFileSync(csrPath, 'utf8')
    .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
    .replace('-----END CERTIFICATE REQUEST-----', '')
    .replace(/\n/g, '');
  console.log('CSR generated, length:', csrContent.length);

  // Step 2: Submit CSR to Apple and get distribution certificate
  console.log('Submitting CSR to Apple...');
  const certResp = await apiRequest('POST', '/v1/certificates', {
    data: {
      type: 'certificates',
      attributes: {
        certificateType: 'IOS_DISTRIBUTION',
        csrContent: csrContent
      }
    }
  }, jwt);

  if (certResp.errors) {
    console.error('Certificate error:', JSON.stringify(certResp.errors));
    process.exit(1);
  }

  const certId = certResp.data.id;
  const certContent = certResp.data.attributes.certificateContent;
  console.log('Certificate received, ID:', certId);

  // Save certificate .cer
  const cerPath = path.join(CREDS_DIR, 'dist.cer');
  fs.writeFileSync(cerPath, Buffer.from(certContent, 'base64'));
  console.log('Certificate saved, size:', fs.statSync(cerPath).size);

  // Convert .cer to .pem
  const pemPath = path.join(CREDS_DIR, 'dist.pem');
  execSync(`openssl x509 -inform DER -in ${cerPath} -out ${pemPath}`);

  // Create .p12
  const p12Path = path.join(CREDS_DIR, 'cert.p12');
  try {
    execSync(`openssl pkcs12 -export -in ${pemPath} -inkey ${keyPath} -out ${p12Path} -passout pass:${CERT_PASSWORD} -legacy`);
  } catch (e) {
    execSync(`openssl pkcs12 -export -in ${pemPath} -inkey ${keyPath} -out ${p12Path} -passout pass:${CERT_PASSWORD}`);
  }
  console.log('P12 created, size:', fs.statSync(p12Path).size);

  // Step 3: Get Bundle ID resource ID
  console.log('Getting bundle ID resource...');
  const bundleResp = await apiRequest('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&filter[platform]=IOS`, null, jwt);
  if (!bundleResp.data || bundleResp.data.length === 0) {
    console.error('Bundle ID not found:', BUNDLE_ID);
    process.exit(1);
  }
  const bundleResourceId = bundleResp.data[0].id;
  console.log('Bundle ID resource:', bundleResourceId);

  // Step 4: Create provisioning profile
  console.log('Creating provisioning profile...');
  const profileName = 'EAS Bubui Production ' + Date.now();
  const profileResp = await apiRequest('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
        certificates: { data: [{ type: 'certificates', id: certId }] }
      }
    }
  }, jwt);

  if (profileResp.errors) {
    console.error('Profile error:', JSON.stringify(profileResp.errors));
    process.exit(1);
  }

  const profileContent = profileResp.data.attributes.profileContent;
  const profileUUID = profileResp.data.attributes.uuid;
  const profPath = path.join(CREDS_DIR, 'app.mobileprovision');
  fs.writeFileSync(profPath, Buffer.from(profileContent, 'base64'));
  console.log('Provisioning profile saved, UUID:', profileUUID, 'size:', fs.statSync(profPath).size);

  // Step 5: Write credentials.json
  const credsJson = {
    ios: {
      distributionCertificate: {
        path: 'ios-creds/cert.p12',
        password: CERT_PASSWORD
      },
      provisioningProfilePath: 'ios-creds/app.mobileprovision'
    }
  };
  fs.writeFileSync('credentials.json', JSON.stringify(credsJson, null, 2));
  console.log('credentials.json written');
  console.log('All iOS credentials generated successfully!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
