import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TerminalSessionEvent } from "../src/shared/types";
import { createTerminalSessionController } from "../src/main/terminalSessions";

const waitForTerminalEvent = async ({
  readDidReceiveEvent,
}: {
  readDidReceiveEvent: () => boolean;
}) => {
  const startedAt = Date.now();

  // TODO: AI-PICKED-VALUE: Five seconds gives the real shell and process-table busy polling time to react in CI without making a broken pty test hang for long.
  while (Date.now() - startedAt < 5000) {
    if (readDidReceiveEvent()) {
      return;
    }

    // TODO: AI-PICKED-VALUE: Polling every twenty milliseconds keeps the test responsive without busy-waiting.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.fail("Timed out waiting for terminal event.");
};

test("starts a terminal session in a cwd and emits output", async () => {
  const terminalSessionEvents: TerminalSessionEvent[] = [];
  const terminalSessionController = createTerminalSessionController({
    sendTerminalSessionEvent: (terminalSessionEvent) => {
      terminalSessionEvents.push(terminalSessionEvent);
    },
  });
  const cwd = await mkdtemp(join(tmpdir(), "crabtree-terminal-"));
  const expectedOutput = "crabtree-terminal-test";

  try {
    const terminalSessionSnapshot =
      await terminalSessionController.startTerminalSession({
        cwd,
        // TODO: AI-PICKED-VALUE: This common terminal size is enough for the one-line echo command used by the regression test.
        cols: 80,
        rows: 24,
      });

    assert.equal(terminalSessionSnapshot.cwd, cwd);
    assert.equal(terminalSessionSnapshot.isRunning, true);
    assert.equal(terminalSessionSnapshot.isBusy, false);

    terminalSessionController.writeTerminalSession({
      cwd,
      data: `echo ${expectedOutput}\r`,
    });

    await waitForTerminalEvent({
      readDidReceiveEvent: () => {
        for (const terminalSessionEvent of terminalSessionEvents) {
          if (
            terminalSessionEvent.type === "data" &&
            terminalSessionEvent.data.includes(expectedOutput)
          ) {
            return true;
          }
        }

        return false;
      },
    });

    const terminalSessionSummaries =
      terminalSessionController.readTerminalSessions();

    assert.equal(terminalSessionSummaries.length, 1);
    assert.equal(terminalSessionSummaries[0].cwd, cwd);
    assert.equal(terminalSessionSummaries[0].isRunning, true);

    terminalSessionController.stopTerminalSession(cwd);

    await waitForTerminalEvent({
      readDidReceiveEvent: () => {
        for (const terminalSessionEvent of terminalSessionEvents) {
          if (
            terminalSessionEvent.type === "status" &&
            terminalSessionEvent.cwd === cwd &&
            !terminalSessionEvent.isRunning
          ) {
            return true;
          }
        }

        return false;
      },
    });
  } finally {
    terminalSessionController.stopAllTerminalSessions();
  }
});

test("marks a terminal session busy while a child process is running", async () => {
  const terminalSessionEvents: TerminalSessionEvent[] = [];
  const terminalSessionController = createTerminalSessionController({
    sendTerminalSessionEvent: (terminalSessionEvent) => {
      terminalSessionEvents.push(terminalSessionEvent);
    },
  });
  const cwd = await mkdtemp(join(tmpdir(), "crabtree-terminal-busy-"));
  const sleepCommand =
    process.platform === "win32" ? "Start-Sleep -Seconds 2\r" : "sleep 2\r";

  try {
    await terminalSessionController.startTerminalSession({
      cwd,
      // TODO: AI-PICKED-VALUE: This common terminal size is enough for the simple sleep command used by the busy-state regression test.
      cols: 80,
      rows: 24,
    });

    terminalSessionController.writeTerminalSession({
      cwd,
      data: sleepCommand,
    });

    await waitForTerminalEvent({
      readDidReceiveEvent: () => {
        for (const terminalSessionEvent of terminalSessionEvents) {
          if (
            terminalSessionEvent.type === "status" &&
            terminalSessionEvent.cwd === cwd &&
            terminalSessionEvent.isBusy
          ) {
            return true;
          }
        }

        return false;
      },
    });
    const terminalSessionEventCountAfterBusy = terminalSessionEvents.length;

    await waitForTerminalEvent({
      readDidReceiveEvent: () => {
        for (
          let index = terminalSessionEventCountAfterBusy;
          index < terminalSessionEvents.length;
          index += 1
        ) {
          const terminalSessionEvent = terminalSessionEvents[index];

          if (
            terminalSessionEvent.type === "status" &&
            terminalSessionEvent.cwd === cwd &&
            !terminalSessionEvent.isBusy
          ) {
            return true;
          }
        }

        return false;
      },
    });
  } finally {
    terminalSessionController.stopAllTerminalSessions();
  }
});
