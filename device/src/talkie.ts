import fs from "fs-extra";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { server as WebSocketServer } from "websocket";
import wavConverter from "wav-converter";
import http from "http";
import { join } from "path";
import { play } from "./audio";

// let isInterrupted = false;

// async function runDemo() {
//   let rawOutputPath = "/home/pi/test/test.wav";

//   const devices = PvRecorder.getAudioDevices();
//   for (let i = 0; i < devices.length; i++) {
//     console.log(`index: ${i}, device name: ${devices[i]}`);
//   }

//   const frameLength = 512;
//   const recorder = new PvRecorder(-1, 512);
//   console.log(`Using PvRecorder version: ${recorder.version}`);

//   recorder.start();
//   console.log(`Using device: ${recorder.getSelectedDevice()}`);

//   let stream;
//   if (rawOutputPath !== null) {
//     stream = fs.createWriteStream(rawOutputPath, { flags: "w" });
//   }

//   while (!isInterrupted) {
//     const pcm = await recorder.read();
//     if (rawOutputPath !== null) {
//       stream.write(Buffer.from(pcm.buffer));
//     }
//   }

//   if (rawOutputPath !== null) {
//     stream.close();
//   }

//   console.log("Stopping...");
//   recorder.release();
// }

// // setup interrupt
// process.on("SIGINT", function () {
//   isInterrupted = true;
// });

// (async function () {
//   try {
//     await runDemo();
//   } catch (e) {
//     console.error(e.toString());
//   }
// })();

var server = http.createServer(function (request, response) {
  console.log(new Date() + " Received request for " + request.url);
  response.writeHead(404);
  response.end();
});
server.listen(3000, function () {
  console.log(new Date() + " Server is listening on port 3000");
});

const wsServer = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: false,
});

type TalkieCommand = "Record" | "Abort" | "Save" | "Query";

const media = {
  discard: "FX-Discard.wav",
  query: "FX-Query.wav",
  record: "FX-Record.wav",
  save: "FX-Save.wav",
  startup: "FX-Startup.wav",
} as const;

console.log("hiooo", __dirname, process.cwd());

function playSoundEffect(key: keyof typeof media) {
  const fileName = media[key];
  const soundPath = join(__dirname, "..", "media", fileName);
  console.log("playing", soundPath);
  play(soundPath);
}

type TalkieState = {
  isRecording: boolean;
};

let talkieState: TalkieState = {
  isRecording: false,
};

function updateTalkieState(updater: (v: TalkieState) => TalkieState) {
  const newState = updater(talkieState);
  talkieState = newState;
}

const recorder = new PvRecorder(-1, 512);

let audioWriteStream: fs.WriteStream | null = null;

let recordTick = Promise.resolve();

let completeRecord: (() => Promise<void>) | null = null;

async function talkieRecord() {
  const recordStartTime = Date.now();
  const recordId = new Date().toISOString();
  if (talkieState.isRecording) return;
  audioWriteStream = fs.createWriteStream(
    `/home/pi/recordings/recording-${recordId}.wtf`,
    { flags: "w" }
  );
  recorder.start();
  let recordedAudioBuffer = Buffer.from([]);

  function handleTick() {
    if (!talkieState.isRecording) return;
    recordTick = recordTick.then(async () => {
      if (!talkieState.isRecording) return;
      console.log("tick about to read");
      const pcm = await recorder.read();
      recordedAudioBuffer = Buffer.concat([
        recordedAudioBuffer,
        Buffer.from(pcm.buffer),
      ]);

      console.log("tick did read");
      audioWriteStream?.write(Buffer.from(pcm.buffer));
      handleTick();
    });
  }

  completeRecord = async () => {
    await recordTick;
    console.log("record tick done.1");
    recorder.release();
    if (audioWriteStream) {
      const wavData = wavConverter.encodeWav(audioWriteStream, {});
      audioWriteStream.close();
      await fs.writeFile(
        `/home/pi/recordings/recording-${recordId}.wav`,
        wavData
      );
    }
  };

  //   if (rawOutputPath !== null) {
  //     stream.close();
  //   }

  playSoundEffect("record");
  updateTalkieState((s) => ({ ...s, isRecording: true }));
  handleTick();
}

function closeRecording() {
  console.log("closeRecording");
  updateTalkieState((v) => ({ ...v, isRecording: false }));
  console.log("about to release");

  if (completeRecord) asyncify(completeRecord());

  // const wavData = audioWriteStream.encodeWav(pcmData)
}

async function talkieAbort() {
  console.log("talkieAbort");
  closeRecording();
  playSoundEffect("discard");
}

async function talkieQuery() {
  console.log("talkieQuery");
  closeRecording();
  playSoundEffect("query");
}

async function talkieSave() {
  console.log("talkieSave");
  closeRecording();
  playSoundEffect("save");
}

function asyncify<V>(promise: Promise<V>) {
  promise.catch((e) => {
    console.error("Failed.", e);
  });
}

function handleTalkieCommand(command: TalkieCommand) {
  console.log("HANDLING COMMAND " + JSON.stringify(command));
  switch (command) {
    case "Abort":
      return asyncify(talkieAbort());
    case "Record":
      return asyncify(talkieRecord());
    case "Query":
      return asyncify(talkieQuery());
    case "Save":
      return asyncify(talkieSave());
  }
}

async function startupTalkie() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // playSoundEffect("startup");
}

startupTalkie();

wsServer.on("request", function (request) {
  // check request.origin and call request.reject() if not allowed

  var connection = request.accept(null, request.origin);
  console.log(new Date() + " Connection accepted.");

  function connectionSend(data: any) {
    connection.sendUTF(JSON.stringify(data));
  }
  connectionSend({ type: "Welcome" });
  connection.on("message", function (message) {
    if (message.type === "utf8") {
      try {
        const payload: TalkieCommand = JSON.parse(message.utf8Data);
        handleTalkieCommand(payload);
      } catch (e) {
        console.error("Failed.", e);
      }
    } else {
      console.error(
        "Received Unknown WS Message (it should be a utf8-JSON TalkieCommand)"
      );
    }
  });
  connection.on("close", function (reasonCode: number, description: string) {
    console.log(
      new Date() + " Peer " + connection.remoteAddress + " disconnected."
    );
  });
});
