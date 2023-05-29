import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";

export function play(fileName: string) {
  const process = spawn("aplay", [
    // when as root you must provide:
    //'--device="hw:CARD=Device,DEV=0"',
    fileName,
  ]);
  const after = new Promise<void>((resolve) => {
    process.on("exit", () => {
      resolve();
      instance.isPlaying = false;
    });
  });
  function stop() {
    if (instance.isPlaying) {
      process.kill("SIGTERM");
    }
  }
  const instance = {
    after,
    stop,
    isPlaying: true,
  };

  return instance;
}

export async function playMp3(fileName: string) {
  const process = spawn("mpg123", [fileName]);
  const after = new Promise<void>((resolve) => {
    process.on("exit", () => {
      resolve();
      instance.isPlaying = false;
    });
  });
  function stop() {
    if (instance.isPlaying) {
      process.kill("SIGTERM");
    }
  }
  const instance = {
    after,
    stop,
    isPlaying: true,
  };

  return instance;
}
