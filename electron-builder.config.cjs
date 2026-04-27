const releaseBaseUrl = process.env.MOLTTREE_UPDATE_BASE_URL;

const config = {
  // TODO: AI-PICKED-VALUE: This bundle id is based on the existing Glass signing identity and the MoltTree app name.
  appId: "com.glassdevtools.molttree",
  productName: "MoltTree",
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json"],
  extraMetadata: {
    main: "out/main/main.js",
  },
  artifactName: "${productName}-${version}-${arch}.${ext}",
  mac: {
    category: "public.app-category.developer-tools",
    target: ["dmg", "zip"],
    icon: "packaging/macos/generated-icons/icon.icns",
    hardenedRuntime: true,
    entitlements: "packaging/macos/entitlements.plist",
    entitlementsInherit: "packaging/macos/entitlements.inherit.plist",
    notarize: true,
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
};

if (releaseBaseUrl) {
  config.publish = [
    {
      provider: "generic",
      url: releaseBaseUrl,
    },
  ];
}

module.exports = config;
