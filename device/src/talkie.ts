import fs from "fs-extra";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { server as WebSocketServer } from "websocket";
import wavConverter from "wav-converter";
import http from "http";
import { join } from "path";
import { play, playMp3 } from "./audio";
import { Gpio } from "onoff";
import * as dotenv from "dotenv";
import {
  ChatCompletionRequestMessage,
  ChatCompletionResponseMessage,
  Configuration,
  OpenAIApi,
} from "openai";
import { Readable } from "node:stream";
import { preamble } from "./chat-preamble";
import * as spi from "spi-device";
dotenv.config();

// const spi = require("spi-device");

type PixelValue = {
  r: number; // from 0-1
  g: number; // from 0-1
  b: number; // from 0-1
};
type LedStrip = PixelValue[]; // 17 pixels exactly!

function hsvToRgb(h: number, s: number, v: number): PixelValue {
  const hi = Math.floor(h / 60) % 6;

  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));

  let r = 0,
    g = 0,
    b = 0;

  switch (hi) {
    case 0:
      (r = v), (g = t), (b = p);
      break;
    case 1:
      (r = q), (g = v), (b = p);
      break;
    case 2:
      (r = p), (g = v), (b = t);
      break;
    case 3:
      (r = p), (g = q), (b = v);
      break;
    case 4:
      (r = t), (g = p), (b = v);
      break;
    case 5:
      (r = v), (g = p), (b = q);
      break;
  }

  return { r, g, b };
}

function rainbowAnimation(timeMS: number, speed = 0.1): LedStrip {
  const leds: LedStrip = [];
  const saturation = 1;
  const value = 0.3; // Limit the combined brightness

  for (let i = 0; i < 17; i++) {
    // Compute the hue based on time and position, to get a slow moving rainbow
    const hue = (timeMS * speed + (i * 360) / 17) % 360;
    leds.push(hsvToRgb(hue, saturation, value));
  }

  return leds;
}

function wavey(
  now: number,
  period = 2_000,
  pixel: PixelValue,
  isSmallWave = false
): LedStrip {
  const pulseValue = Math.sin((now / period) * Math.PI * 2);
  const fullWavePixel = Math.floor(((pulseValue + 1) * LED_STRIP_COUNT) / 2);
  const smallWavePixel = Math.floor(((pulseValue + 1) * 5) / 2) + 6;
  const frame = fillAllLeds({ r: 0, g: 0, b: 0 });
  const index = isSmallWave ? smallWavePixel : fullWavePixel;
  frame[index] = pixel;
  return frame;
}

const LED_STRIP_COUNT = 17;

function fillAllLeds(pixel: PixelValue) {
  return Array(LED_STRIP_COUNT).fill(pixel);
}

const OFF_LEDS = fillAllLeds({
  r: 0,
  g: 0,
  b: 0,
});

let writeFrame: (leds: PixelValue[]) => Promise<void> = async () => {};

let frameCount = 0;

type TalkieState = {
  isRecording: boolean;
  loadingState: null | "transcribe" | "infer" | "speak";
  // isTranscribing: boolean;
  // isInferring: boolean;
};

let talkieState: TalkieState = {
  isRecording: false,
  loadingState: null,
};
let frameCountSecAgo = 0;
setInterval(() => {
  const recentFrames = frameCount - frameCountSecAgo;
  process.stdout.write(" fps: " + recentFrames + " \n");
  frameCountSecAgo = frameCount;
}, 1_000);
async function writeCurrentLEDFrame() {
  frameCount += 1;
  const now = Date.now();

  const frame = rainbowAnimation(now);
  // const frame = wavey(now, 500, { r: 0.2, g: 0, b: 0 }, true);

  await new Promise((resolve) => setTimeout(resolve, 1000 / 66));

  await writeFrame(frame);
}

// const startTime = Date.now()
// setInterval(() => {
//   frameCount
// }, 2000)

async function scheduleFrameWrite() {
  writeCurrentLEDFrame()
    .then(scheduleFrameWrite)
    .catch((e) => {
      console.error("failed to write LED frame", e);
    });
}
scheduleFrameWrite();

const ledOutput = spi.open(0, 0, (err) => {
  if (err) {
    console.error("LED SPI open fail");
    console.error(err);
    return;
  }
  console.log("ledou", ledOutput.getOptionsSync());

  writeFrame(
    fillAllLeds({
      r: 0,
      g: 0.0,
      b: 0.1,
    })
  );
  console.log("openened");
  const sendBuffer = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x00,
    ...OFF_LEDS.map((led) => {
      const { r, g, b } = led;
      return [0b111_00000 | 31, b * 255, g * 255, r * 255];
    }).flat(),
    0xff,
    0xff,
    0xff,
    0xff,
  ]);
  const receiveBuffer = Buffer.allocUnsafe(sendBuffer.length);
  writeFrame = async (leds: PixelValue[]) => {
    leds.forEach((led, ledIndex) => {
      const { r, g, b } = led;
      const offset = (ledIndex + 1) * 4;
      sendBuffer[offset + 0] = 0b111_00000 | 31;
      sendBuffer[offset + 1] = b * 255;
      sendBuffer[offset + 2] = g * 255;
      sendBuffer[offset + 3] = r * 255;
    });

    // const sendBuffer = Buffer.from([
    //   0x00,
    //   0x00,
    //   0x00,
    //   0x00,
    //   ...leds
    //     .map((led) => {
    //       const { r, g, b } = led;
    //       return [0b111_00000 | 31, b * 255, g * 255, r * 255];
    //     })
    //     .flat(),
    //   0xff,
    //   0xff,
    //   0xff,
    //   0xff,
    // ]);

    // if (frameCount < 50) {
    process.stdout.write("\r" + frameCount);
    // process.stdout.write(sendBuffer.toString("hex"));
    // }
    const before = Date.now();
    await new Promise<void>((resolve, reject) =>
      ledOutput.transfer(
        [
          {
            sendBuffer,
            receiveBuffer,
            byteLength: sendBuffer.length,
            speedHz: 1_000_000,
          },
        ],
        (err, resp) => {
          if (err) {
            reject(err);
            console.error("LED write buffer fail");
            console.error(err);
          } else {
            resolve();
          }
        }
      )
    );
    const after = Date.now();
    process.stdout.write(" duration: " + (after - before) + "  ");
  };
});
const makeMessage = (role, content) => ({ role, content });

let history: ChatCompletionRequestMessage[] = [
  // { role: "system", content: "you are an AI assistant. answer tersely" },
  ...preamble(
    {
      shortName: process.env.USER_SHORTNAME || "TU",
      fullName: process.env.USER_NAME || "Test User",
    },
    {}
  ),
];

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_KEY })
);

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

const testButton = new Gpio(14, "in", "both", {
  debounceTimeout: 20,
});

const buttonLed = new Gpio(4, "out", undefined, {
  // debounceTimeout: 20,
});

buttonLed.writeSync(1);

const media = {
  discard: "FX-Discard.wav",
  query: "FX-Query.wav",
  record: "FX-Record.wav",
  save: "FX-Save.wav",
  startup: "FX-Startup.wav",
} as const;

function playSoundEffect(key: keyof typeof media) {
  const fileName = media[key];
  const soundPath = join(__dirname, "..", "media", fileName);
  play(soundPath);
}

testButton.watch((err, isUp) => {
  console.log("Button Interrupt! " + (isUp ? "(up)" : "(down)"));
  if (isUp) {
    if (talkieState.isRecording) {
      talkieQuery();
    } else {
      talkieRecord();
    }
  }
});

function updateTalkieState(updater: (v: TalkieState) => TalkieState) {
  const newState = updater(talkieState);
  talkieState = newState;
}

const recorder = new PvRecorder(-1, 512);

let audioWriteStream: fs.WriteStream | null = null;

let recordTick = Promise.resolve();

let completeRecord:
  | (() => Promise<{ id: string; wavPath: string } | null>)
  | null = null;

async function talkieRecord() {
  if (talkieState.isRecording) return;
  playSoundEffect("record");

  const recordStartTime = Date.now();
  const recordId = new Date().toISOString();
  audioWriteStream = fs.createWriteStream(
    `/home/pi/recordings/recording-${recordId}.pcm`,
    { flags: "w" }
  );
  recorder.start();
  let recordedAudioBuffer = Buffer.from([]);

  function handleTick() {
    if (!talkieState.isRecording) return;
    recordTick = recordTick.then(async () => {
      if (!talkieState.isRecording) return;
      const pcm = await recorder.read();
      recordedAudioBuffer = Buffer.concat([
        recordedAudioBuffer,
        Buffer.from(pcm.buffer),
      ]);
      audioWriteStream?.write(Buffer.from(pcm.buffer));
      handleTick();
    });
  }

  completeRecord = async () => {
    await recordTick;
    recorder.stop();
    if (audioWriteStream) {
      audioWriteStream.close();
    }
    if (recordedAudioBuffer) {
      const wavData = wavConverter.encodeWav(recordedAudioBuffer, {});
      const wavPath = `/home/pi/recordings/recording-${recordId}.wav`;
      await fs.writeFile(wavPath, wavData);
      return {
        id: recordId,
        wavPath,
      };
    }
    return null;
  };

  updateTalkieState((s) => ({ ...s, isRecording: true }));
  handleTick();
}

async function closeRecording() {
  updateTalkieState((v) => ({ ...v, isRecording: false }));

  if (completeRecord) return await completeRecord();

  return null;
}

async function sayText(text: string) {
  updateTalkieState((s) => ({ ...s, loadingState: "infer" }));

  const sayingId = new Date().toISOString();
  const sayingPath = `/home/pi/say/${sayingId}.mp3`;
  // const someVoice = 8rhGl4iiilgahpSoYwwp
  const url = `https://api.elevenlabs.io/v1/text-to-speech/8rhGl4iiilgahpSoYwwp`;
  const res = await fetch(url, {
    headers: {
      "content-type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_KEY || "",
    },
    method: "post",
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0,
      },
    }),
  });
  if (res.status !== 200) {
    console.error(await res.text());
    throw new Error("Failed to say");
  }
  const blob = await res.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(sayingPath, buffer);
  updateTalkieState((s) => ({ ...s, loadingState: "speak" }));

  await playMp3(sayingPath);
  updateTalkieState((s) => ({ ...s, loadingState: null }));
}

async function talkieAbort() {
  await closeRecording();
  playSoundEffect("discard");

  sayText("ooh push my buttons, big brother");
}

async function talkieQuery() {
  const recording = await closeRecording();

  playSoundEffect("query");

  if (!recording) return;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const audioReadStream = Readable.from(await fs.readFile(recording.wavPath));
  // @ts-ignore
  audioReadStream.path = "conversation.wav";
  updateTalkieState((s) => ({ ...s, loadingState: "transcribe" }));

  const {
    data: { text },
  } = await openai.createTranscription(
    // @ts-ignore
    audioReadStream,
    "whisper-1"
  );

  updateTalkieState((s) => ({ ...s, loadingState: "infer" }));

  history = [...history, { role: "user", content: text }];

  const { data } = await openai.createChatCompletion({
    messages: history,
    model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
    temperature: 0.7,
  });
  const message = data.choices[0].message;

  console.log(":::" + message?.content);

  if (!message) {
    throw new Error("Message could not be extracted from result");
  }
  history = [...history, message];

  // function handleCompletion(message: ChatCompletionResponseMessage) {

  // }

  const matchedSay = message?.content.match(/\$say:(?<statement>.*)$/m);
  const statementOutLout = matchedSay?.groups?.statement;
  const matchedSayNothing = message?.content.match(/\$saynothing/m);

  if (statementOutLout || matchedSayNothing) {
    if (statementOutLout) sayText(statementOutLout);
  } else {
    // ERROR CORRECTION BEHAVIOR

    history = [
      ...history,
      {
        role: "system",
        content:
          "please continue by writing $say: with a statement to speak out loud, or if appropriate, stay silent with $saynothing",
      },
    ];

    // console.log("FUll query", history);
    const { data } = await openai.createChatCompletion({
      messages: history,
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      temperature: 0.7,
    });
    const message = data.choices[0].message;

    console.log(":::" + message?.content);

    if (!message) {
      throw new Error("Message could not be extracted from result");
    }
    history = [...history, message];

    // fallback. the ai screwed up
    console.log("todooooo", message);
  }
}

async function talkieSave() {
  await closeRecording();
  playSoundEffect("save");
}

function asyncify<V>(promise: Promise<V>) {
  promise.catch((e) => {
    console.error("Failed.", e);
  });
}

function handleTalkieCommand(command: TalkieCommand) {
  console.log("Command: " + JSON.stringify(command));
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
