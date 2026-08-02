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
// Extensión de notificaciones (plugins/withIosNotificationServiceExtension.js):
// es un target propio y necesita SU bundle id y SU provisioning profile.
const NSE_TARGET = 'BubuiNotificationService';
const NSE_BUNDLE_ID = BUNDLE_ID + '.' + NSE_TARGET;
// Nombre del target principal generado por expo prebuild (app.json "name").
const MAIN_TARGET = 'Bubui';
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
function apiRequest(method, urlPath, body, jwt) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.appstoreconnect.apple.com',
      path: urlPath,
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
        if (res.statusCode === 204 || data.trim() === '') {
          resolve({ status: res.statusCode });
        } else {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
        }
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

  // Step 0: Revoke all existing iOS Distribution certificates
  console.log('Checking for existing distribution certificates...');
  const existingCerts = await apiRequest('GET', '/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=10', null, jwt);
  if (existingCerts.data && existingCerts.data.length > 0) {
    console.log('Found', existingCerts.data.length, 'existing certificate(s), revoking...');
    for (const cert of existingCerts.data) {
      console.log('Revoking cert ID:', cert.id);
      const delResult = await apiRequest('DELETE', '/v1/certificates/' + cert.id, null, jwt);
      console.log('Revoked, status:', delResult.status);
    }
    console.log('All existing certificates revoked.');
  } else {
    console.log('No existing distribution certificates found.');
  }

  // Step 1: Generate private key and CSR using openssl
  console.log('Generating private key and CSR...');
  const keyPath = path.join(CREDS_DIR, 'dist.key');
  const csrPath = path.join(CREDS_DIR, 'dist.csr');
  execSync('openssl genrsa -out ' + keyPath + ' 2048');
  execSync('openssl req -new -key ' + keyPath + ' -out ' + csrPath + ' -subj \'/CN=iPhone Distribution/O=Negocio Vivo/C=ES\'');
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
  execSync('openssl x509 -inform DER -in ' + cerPath + ' -out ' + pemPath);

  // Create .p12
  const p12Path = path.join(CREDS_DIR, 'cert.p12');
  try {
    execSync('openssl pkcs12 -export -in ' + pemPath + ' -inkey ' + keyPath + ' -out ' + p12Path + ' -passout pass:' + CERT_PASSWORD + ' -legacy');
  } catch (e) {
    execSync('openssl pkcs12 -export -in ' + pemPath + ' -inkey ' + keyPath + ' -out ' + p12Path + ' -passout pass:' + CERT_PASSWORD);
  }
  console.log('P12 created, size:', fs.statSync(p12Path).size);

  // Step 3: Resolve (or register) the Bundle ID resources for BOTH targets.
  // La app principal ya existe en el portal; el de la extensión de
  // notificaciones se registra aquí la primera vez.
  async function getOrCreateBundleId(identifier, name) {
    const found = await apiRequest('GET', '/v1/bundleIds?filter[identifier]=' + identifier + '&filter[platform]=IOS', null, jwt);
    // El filtro de la API hace substring-match: exige coincidencia exacta.
    const exact = (found.data || []).find((b) => b.attributes && b.attributes.identifier === identifier);
    if (exact) {
      console.log('Bundle ID exists:', identifier, '→', exact.id);
      return exact.id;
    }
    console.log('Registering bundle ID:', identifier);
    const created = await apiRequest('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: identifier, name: name, platform: 'IOS' } }
    }, jwt);
    if (created.errors) {
      console.error('Bundle ID registration error:', JSON.stringify(created.errors));
      process.exit(1);
    }
    console.log('Bundle ID registered:', identifier, '→', created.data.id);
    return created.data.id;
  }

  const mainBundleResourceId = await getOrCreateBundleId(BUNDLE_ID, 'Bubui');
  const nseBundleResourceId = await getOrCreateBundleId(NSE_BUNDLE_ID, 'Bubui Notification Service');

  // Step 4: Create one App Store provisioning profile per target (mismo cert).
  async function createProfile(label, bundleResourceId, fileName) {
    console.log('Creating provisioning profile for', label, '...');
    const profileResp = await apiRequest('POST', '/v1/profiles', {
      data: {
        type: 'profiles',
        attributes: { name: 'EAS Bubui ' + label + ' ' + Date.now(), profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
          certificates: { data: [{ type: 'certificates', id: certId }] }
        }
      }
    }, jwt);
    if (profileResp.errors) {
      console.error('Profile error (' + label + '):', JSON.stringify(profileResp.errors));
      process.exit(1);
    }
    const profPath = path.join(CREDS_DIR, fileName);
    fs.writeFileSync(profPath, Buffer.from(profileResp.data.attributes.profileContent, 'base64'));
    console.log('Profile saved (' + label + '), UUID:', profileResp.data.attributes.uuid, 'size:', fs.statSync(profPath).size);
  }

  await createProfile('Production', mainBundleResourceId, 'app.mobileprovision');
  await createProfile('NSE', nseBundleResourceId, 'nse.mobileprovision');

  // Step 5: Write credentials.json MULTI-TARGET: las claves deben coincidir
  // con los nombres de target del proyecto Xcode que genera expo prebuild
  // (app principal = app.json "name"; extensión = TARGET_NAME del plugin
  // withIosNotificationServiceExtension).
  const distributionCertificate = {
    path: 'ios-creds/cert.p12',
    password: CERT_PASSWORD
  };
  const credsJson = {
    ios: {
      [MAIN_TARGET]: {
        distributionCertificate: distributionCertificate,
        provisioningProfilePath: 'ios-creds/app.mobileprovision'
      },
      [NSE_TARGET]: {
        distributionCertificate: distributionCertificate,
        provisioningProfilePath: 'ios-creds/nse.mobileprovision'
      }
    }
  };
  fs.writeFileSync('credentials.json', JSON.stringify(credsJson, null, 2));
  console.log('credentials.json written (multi-target: ' + MAIN_TARGET + ' + ' + NSE_TARGET + ')');
  console.log('All iOS credentials generated successfully!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
