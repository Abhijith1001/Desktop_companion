// Builds the Microsoft Store package (.appx) into release/.
// The Store signs the package itself, so no certificate is needed here. The
// three identity values come from Partner Center → your app → Product
// management → Product identity:
//
//   STORE_IDENTITY_NAME   Package/Identity/Name           e.g. 12345Devwerks.DesktopBuddy
//   STORE_PUBLISHER       Package/Identity/Publisher      e.g. CN=1A2B3C4D-....
//   STORE_PUBLISHER_NAME  Package/Properties/PublisherDisplayName  e.g. Devwerks
//
// Run with: npm run dist:store (after setting the variables)
const builder = require('electron-builder');

const missing = ['STORE_IDENTITY_NAME', 'STORE_PUBLISHER', 'STORE_PUBLISHER_NAME'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Copy them from Partner Center → Product identity (see RELEASING.md).`);
  process.exit(1);
}

builder.build({
  targets: builder.Platform.WINDOWS.createTarget('appx', builder.Arch.x64),
  publish: 'never',
  config: {
    appx: {
      identityName: process.env.STORE_IDENTITY_NAME,
      publisher: process.env.STORE_PUBLISHER,
      publisherDisplayName: process.env.STORE_PUBLISHER_NAME,
      displayName: 'Desktop Buddy',
      backgroundColor: '#e8994a',
      languages: ['en-US'],
      artifactName: 'Desktop-Buddy-${version}.${ext}',
    },
  },
}).then((files) => {
  console.log('Store package ready:\n  ' + files.join('\n  '));
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
