const config = {
  // TODO: AI-PICKED-VALUE: This bundle id matches the BranchMaster GitHub organization and product name.
  appId: "com.glassdevtools.branchmaster",
  productName: "BranchMaster",
  electronVersion: "41.3.0",
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json"],
  asarUnpack: ["node_modules/@lydell/node-pty-*/prebuilds/**/*"],
  extraMetadata: {
    main: "out/main/main.js",
  },
  electronUpdaterCompatibility: ">=2.16",
  artifactName: "${productName}-${version}-${arch}.${ext}",
  publish: [
    {
      provider: "github",
      owner: "glassdevtools",
      repo: "branchmaster",
      releaseType: "release",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    target: [
      {
        target: "dmg",
        arch: ["universal"],
      },
      {
        target: "zip",
        arch: ["universal"],
      },
    ],
    icon: "packaging/macos/icon.icon",
    // node-pty ships both mac architecture packages in each app build, so universal merging should leave those prebuilds as separate files.
    x64ArchFiles:
      "Contents/Resources/app.asar.unpacked/node_modules/@lydell/node-pty-*/prebuilds/**/*",
    extendInfo: {
      NSDesktopFolderUsageDescription:
        "BranchMaster needs access to repositories stored on your Desktop so it can read their Git history.",
      NSDocumentsFolderUsageDescription:
        "BranchMaster needs access to repositories stored in Documents so it can read their Git history.",
      NSDownloadsFolderUsageDescription:
        "BranchMaster needs access to repositories stored in Downloads so it can read their Git history.",
    },
    hardenedRuntime: true,
    entitlements: "packaging/macos/entitlements.plist",
    entitlementsInherit: "packaging/macos/entitlements.inherit.plist",
    notarize: true,
  },
  win: {
    target: [
      {
        target: "nsis",
        // TODO: AI-PICKED-VALUE: Windows starts with x64 because it covers normal Windows installs without increasing installer size for 32-bit support.
        arch: ["x64"],
      },
    ],
    icon: "src/renderer/assets/default-app-icon.png",
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    background: "packaging/macos/generated-icons/dmg-background.png",
    icon: "packaging/macos/generated-icons/icon.icns",
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
