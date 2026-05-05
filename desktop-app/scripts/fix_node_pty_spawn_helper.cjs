const fs = require("node:fs/promises");
const path = require("node:path");

const fixNodePtySpawnHelper = async () => {
  if (process.platform === "win32") {
    return;
  }

  const nodePtyPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
  const nodePtyIndexPath = require.resolve(nodePtyPackage);
  const nodePtyRoot = path.dirname(path.dirname(nodePtyIndexPath));
  const prebuildsRoot = path.join(nodePtyRoot, "prebuilds");
  const prebuildDirs = await fs.readdir(prebuildsRoot, { withFileTypes: true });
  const fixedFiles = [];

  for (const prebuildDir of prebuildDirs) {
    if (!prebuildDir.isDirectory()) {
      continue;
    }

    const spawnHelperPath = path.join(
      prebuildsRoot,
      prebuildDir.name,
      "spawn-helper",
    );
    const spawnHelperStat = await fs.stat(spawnHelperPath);

    if ((spawnHelperStat.mode & 0o111) === 0o111) {
      continue;
    }

    await fs.chmod(spawnHelperPath, spawnHelperStat.mode | 0o755);
    fixedFiles.push(spawnHelperPath);
  }

  if (fixedFiles.length > 0) {
    console.log(
      `fixed node-pty permissions for ${fixedFiles.length} helper${
        fixedFiles.length === 1 ? "" : "s"
      }`,
    );
  }
};

fixNodePtySpawnHelper().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
