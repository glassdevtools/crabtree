const config = {
  // TODO: AI-PICKED-VALUE: This bundle id is based on the existing Glass signing identity and the MoltTree app name.
  appId: "com.glassdevtools.molttree",
  productName: "MoltTree",
  electronVersion: "41.3.0",
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json"],
  extraMetadata: {
    main: "out/main/main.js",
  },
  electronUpdaterCompatibility: ">=2.16",
  artifactName: "${productName}-${version}-${arch}.${ext}",
  publish: [
    {
      provider: "github",
      owner: "glassdevtools",
      repo: "molttree",
      releaseType: "release",
    },
  ],
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
    background: "packaging/macos/generated-icons/dmg-background.png",
    // TODO: AI-PICKED-VALUE: These icon centers keep the default DMG spacing but move the row up to the middle of the visible area.
    contents: [
      {
        x: 130,
        y: 145,
        type: "file",
      },
      {
        x: 410,
        y: 145,
        type: "link",
        path: "/Applications",
      },
    ],
  },
};

module.exports = config;
