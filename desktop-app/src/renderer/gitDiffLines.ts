const readIsGitDiffHeaderLine = (line: string) => {
  return (
    line.startsWith("diff --") ||
    line.startsWith("@@") ||
    line.startsWith("index ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("copy from ") ||
    line.startsWith("copy to ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("\\ No newline at end of file")
  );
};

export const readGitDiffMarkerColumnCount = (diff: string) => {
  for (const line of diff.split("\n")) {
    if (!line.startsWith("@@")) {
      continue;
    }

    let hunkMarkerCount = 0;

    while (line[hunkMarkerCount] === "@") {
      hunkMarkerCount += 1;
    }

    return Math.max(1, hunkMarkerCount - 1);
  }

  return 1;
};

export const readGitDiffLineDisplay = ({
  line,
  markerColumnCount,
}: {
  line: string;
  markerColumnCount: number;
}): { changeType: "added" | "removed" | "context"; text: string } | null => {
  if (readIsGitDiffHeaderLine(line)) {
    return null;
  }

  const markers = line.slice(0, markerColumnCount);

  if (markers.length !== markerColumnCount) {
    return { changeType: "context", text: line };
  }

  let shouldTreatAsAdded = false;
  let shouldTreatAsRemoved = false;

  for (const marker of markers) {
    switch (marker) {
      case "+":
        shouldTreatAsAdded = true;
        break;
      case "-":
        shouldTreatAsRemoved = true;
        break;
      case " ":
        break;
      default:
        return { changeType: "context", text: line };
    }
  }

  if (shouldTreatAsAdded) {
    return { changeType: "added", text: line.slice(markerColumnCount) };
  }

  if (shouldTreatAsRemoved) {
    return { changeType: "removed", text: line.slice(markerColumnCount) };
  }

  return { changeType: "context", text: line.slice(markerColumnCount) };
};

export const readGitDiffLineCounts = ({
  diff,
  markerColumnCount,
}: {
  diff: string;
  markerColumnCount: number;
}) => {
  const lineCounts = {
    added: 0,
    removed: 0,
  };

  for (const line of diff.split("\n")) {
    const lineDisplay = readGitDiffLineDisplay({ line, markerColumnCount });

    if (lineDisplay === null) {
      continue;
    }

    switch (lineDisplay.changeType) {
      case "added":
        lineCounts.added += 1;
        break;
      case "removed":
        lineCounts.removed += 1;
        break;
      case "context":
        break;
    }
  }

  return lineCounts;
};
